-- Çalışan (staff) yetki sınırı + değişiklik geçmişi.
-- Supabase panelinde SQL Editor'a yapıştırıp çalıştır. Mevcut kayıtlara dokunmaz.

-- 1) Eski halleri saklayan geçmiş tablosu (sadece dükkân sahibi okur)
create table if not exists public.docs_log (
  id bigint generated always as identity primary key,
  shop_id uuid not null,
  kind text not null,
  doc_id text not null,
  old_data jsonb,
  old_deleted boolean,
  old_by uuid,
  old_at timestamptz,
  new_deleted boolean,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists docs_log_shop_at on public.docs_log (shop_id, changed_at desc);
alter table public.docs_log enable row level security;
drop policy if exists docs_log_read on public.docs_log;
create policy docs_log_read on public.docs_log for select to authenticated
  using (is_owner(shop_id) or is_admin());
revoke all on public.docs_log from anon, authenticated;
grant select on public.docs_log to authenticated;

create or replace function public.docs_log_fn() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (old.data is distinct from new.data or old.deleted is distinct from new.deleted) then
    insert into docs_log (shop_id, kind, doc_id, old_data, old_deleted, old_by, old_at, new_deleted, changed_by)
    values (old.shop_id, old.kind, old.id, old.data, old.deleted, old.updated_by, old.updated_at, new.deleted, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists docs_zlog on public.docs;
create trigger docs_zlog after update on public.docs for each row execute function public.docs_log_fn();

-- 2) Çalışan sınırı (güncel sürüm; tekrar çalıştırmak güvenlidir)
--  * kasa kaydı yazamaz, okuyamaz
--  * yeni satış / stok / ürün / müşteri kaydı ekleyebilir
--  * satış: iade yazamaz; ürün fiyatı kayıtlı fiyattan farklı olamaz; toplam kalemlerle tutmalı
--  * fire / arıza / iade kaydı giremez; stoğu azaltan sayım giremez
--  * başkasının kaydını değiştiremez ya da silemez; kendi kaydını 2 dk içinde geri alabilir
--  * ürüne fiyat yazamaz / değiştiremez; fiyatı olmayan ürünü ve listede olmayan kalemi satamaz
--  * var olan müşteriyi değiştiremez
--  * Sahip Ayarlar'dan izin verirse (docs: settings/staffperm: fire, iade, azalt, serbest, fiyat, musteri, sil) o kısıtlar kalkar
create or replace function public.docs_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  o public.docs;
  win interval := interval '2 minutes';
  osale numeric; nsale numeric; obuy numeric; nbuy numeric;
  etype text; wasv numeric; i jsonb; ps numeric; sm numeric := 0; perm jsonb;
begin
  if me is null then return new; end if;                      -- servis / cron
  if is_owner(new.shop_id) or is_admin() then return new; end if;
  if new.kind = 'settings' and new.id = 'staffperm' then
    raise exception 'YETKI: çırak yetkilerini sadece dükkân sahibi değiştirir' using errcode = 'P0001';
  end if;
  select data into perm from docs where shop_id = new.shop_id and kind = 'settings' and id = 'staffperm' and not deleted;
  perm := coalesce(perm, '{}'::jsonb);                         -- sahibin açtığı izinler; boşsa hepsi kapalı
  if new.kind = 'cash' then
    raise exception 'YETKI: kasa kaydını sadece dükkân sahibi değiştirebilir' using errcode = 'P0001';
  end if;
  if new.deleted = false then
    if new.kind = 'event' then
      etype := new.data->>'type';
      if (etype in ('fire','ariza') and not coalesce((perm->>'fire')::boolean,false)) or (etype = 'iade' and not coalesce((perm->>'iade')::boolean,false)) then
        raise exception 'YETKI: fire ve iade kaydını sadece dükkân sahibi girer' using errcode = 'P0001';
      end if;
      if etype = 'sayim' then
        wasv := nullif(new.data->>'was','')::numeric;
        if (wasv is null or coalesce(nullif(new.data->>'qty','')::numeric, 0) < wasv) and not coalesce((perm->>'azalt')::boolean,false) then
          raise exception 'YETKI: stoğu azaltmayı sadece dükkân sahibi yapar' using errcode = 'P0001';
        end if;
      end if;
    elsif new.kind = 'sale' then
      if coalesce((new.data->>'r')::boolean, false) and not coalesce((perm->>'iade')::boolean,false) then
        raise exception 'YETKI: iade satışını sadece dükkân sahibi yapar' using errcode = 'P0001';
      end if;
      for i in select * from jsonb_array_elements(coalesce(new.data->'it','[]'::jsonb)) loop
        if coalesce(nullif(i->>'q','')::numeric, 0) <= 0 or coalesce(nullif(i->>'u','')::numeric, 0) <= 0 then
          raise exception 'YETKI: satış kalemi hatalı' using errcode = 'P0001';
        end if;
        if coalesce(i->>'p','-') = '-' and not coalesce((perm->>'serbest')::boolean,false) then
          raise exception 'YETKI: listede olmayan kalemi sadece dükkân sahibi satar' using errcode = 'P0001';
        end if;
        sm := sm + (i->>'q')::numeric * (i->>'u')::numeric;
        if coalesce(i->>'p','-') <> '-' and not coalesce((perm->>'fiyat')::boolean,false) then
          select nullif(data->>'salePrice','')::numeric into ps from docs
            where shop_id = new.shop_id and kind = 'product' and id = i->>'p' and not deleted;
          if ps is null or ps <= 0 then
            raise exception 'YETKI: fiyatı olmayan ürünü sadece dükkân sahibi satar' using errcode = 'P0001';
          end if;
          if abs((i->>'u')::numeric - ps) > 0.005 then
            raise exception 'YETKI: satış fiyatını sadece dükkân sahibi değiştirir' using errcode = 'P0001';
          end if;
        end if;
      end loop;
      if abs(coalesce(nullif(new.data->>'tot','')::numeric, 0) - sm) > 0.02 then
        raise exception 'YETKI: satış tutarı kalemlerle tutmuyor' using errcode = 'P0001';
      end if;
    end if;
  end if;
  select * into o from docs where shop_id = new.shop_id and kind = new.kind and id = new.id;
  if not found then                                           -- yeni kayıt serbest, ama çırak ürüne fiyat yazamaz
    if new.kind = 'product' and not new.deleted and not coalesce((perm->>'fiyat')::boolean,false) and (coalesce(nullif(new.data->>'salePrice','')::numeric,0) > 0 or coalesce(nullif(new.data->>'buyPrice','')::numeric,0) > 0) then
      raise exception 'YETKI: ürün fiyatını sadece dükkân sahibi yazar' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.kind = 'product' and not new.deleted and not coalesce((perm->>'fiyat')::boolean,false) and (coalesce(nullif(new.data->>'salePrice','')::numeric,0) <> coalesce(nullif(o.data->>'salePrice','')::numeric,0) or coalesce(nullif(new.data->>'buyPrice','')::numeric,0) <> coalesce(nullif(o.data->>'buyPrice','')::numeric,0)) then
    raise exception 'YETKI: fiyatı sadece dükkân sahibi değiştirebilir' using errcode = 'P0001';
  end if;
  if o.updated_by = me and o.updated_at > now() - win then return new; end if;
  if new.kind = 'product' and new.deleted = false then
    osale := coalesce(nullif(o.data->>'salePrice','')::numeric, 0);
    nsale := coalesce(nullif(new.data->>'salePrice','')::numeric, 0);
    obuy  := coalesce(nullif(o.data->>'buyPrice','')::numeric, 0);
    nbuy  := coalesce(nullif(new.data->>'buyPrice','')::numeric, 0);
    return new;                                               -- fiyat değişimi yukarıda engellendi
  end if;
  if new.kind in ('supplier','settings') and new.deleted = false then return new; end if;
  if new.kind = 'customer' and not new.deleted and coalesce((perm->>'musteri')::boolean,false) then return new; end if;
  if new.deleted and new.kind not in ('cash','settings') and coalesce((perm->>'sil')::boolean,false) then return new; end if;
  raise exception 'YETKI: bu kaydı değiştirme ya da silme yetkin yok' using errcode = 'P0001';
end $$;
drop trigger if exists docs_guard on public.docs;
create trigger docs_guard before insert or update on public.docs for each row execute function public.docs_guard();

-- 3) Okuma sınırı: çalışan kasa kayıtlarını okuyamaz, satış raporunu çekemez
drop policy if exists docs_read on public.docs;
create policy docs_read on public.docs for select to authenticated
  using (is_member(shop_id) and (kind <> 'cash' or is_owner(shop_id)));

do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'pos_report';
  if d like '%if not is_member(p_shop) then%' then
    d := replace(d, 'if not is_member(p_shop) then', 'if not (is_owner(p_shop) or is_admin()) then');
    execute d;
  end if;
end $$;

-- 4) Bildirimler: çalışan kasa/rapor bildirimi alamaz
create or replace function public.push_save(p_shop uuid, p_endpoint text, p_p256dh text, p_auth text, p_app text, p_types text[], p_ua text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare staff boolean;
begin
  if auth.uid() is null then raise exception 'Giriş gerekli.' using errcode = '42501'; end if;
  if p_shop is not null and not public.is_member(p_shop) then raise exception 'Bu dükkânın kayıtlarına erişimin yok.' using errcode = '42501'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000
     or coalesce(char_length(p_p256dh), 0) not between 20 and 200 or coalesce(char_length(p_auth), 0) not between 8 and 100 then
    raise exception 'Bildirim kaydı hatalı.' using errcode = 'P0001'; end if;
  staff := p_shop is not null and not public.is_owner(p_shop) and not public.is_admin();
  insert into push_subs (endpoint, user_id, shop_id, p256dh, auth, app, types, ua)
  values (p_endpoint, auth.uid(), p_shop, p_p256dh, p_auth, case when p_app = 'kolay' then 'kolay' else 'tam' end,
          coalesce((select array_agg(distinct t) from unnest(coalesce(p_types, '{}')) t
                    where t in ('stok','bitti','kasa','cikis','veresiye','basvuru','rgun','rhafta','ray','tedarik','calisan')
                      and not (staff and t in ('kasa','cikis','rgun','rhafta','ray','basvuru','calisan'))), '{}'),
          left(p_ua, 200))
  on conflict (endpoint) do update set user_id = excluded.user_id, shop_id = excluded.shop_id, p256dh = excluded.p256dh, auth = excluded.auth,
    app = excluded.app, types = excluded.types, ua = excluded.ua, updated_at = now();
  -- aynı telefon (aynı tarayıcı kimliği) tek kayıt: iki uygulama kurulduysa en son açılan bildirim alır
  if coalesce(p_ua, '') <> '' then delete from push_subs where user_id = auth.uid() and ua = left(p_ua, 200) and endpoint <> p_endpoint; end if;
  delete from push_subs where user_id = auth.uid() and endpoint in (
    select endpoint from push_subs where user_id = auth.uid() order by updated_at desc offset 20);
end $$;

-- mevcut çalışan abonelikleri temizle
update push_subs ps set types = array(select t from unnest(ps.types) t where t not in ('kasa','cikis','rgun','rhafta','ray','basvuru','calisan'))
where exists (select 1 from members m where m.user_id = ps.user_id and m.shop_id = ps.shop_id and m.role = 'staff');
