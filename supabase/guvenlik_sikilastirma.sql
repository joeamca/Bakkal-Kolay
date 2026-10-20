-- Canlı test raporu (KAN-34, KAN-35, KAN-36): sunucu tarafı sıkılaştırma
-- 1) Çıraktan sahibe dönüş PIN'i: her kilitte bekleme uzar (15 dk → 1 sa → 6 sa → 24 sa); doğru PIN sayacı sıfırlar.
-- 2) docs_guard: çırak eksi/sıfır "mal geldi" yazamaz; sayımda stok azaltma kontrolü telefonun gönderdiği "was"a güvenmez,
--    satış kullanan dükkânlarda raftaki beklenen sayı sunucuda hesaplanır (son sayım + gelen − fire − satılan).
-- 3) docs_guard: çırak tedarikçi kaydını değiştiremez; dükkân ayarında sadece görünüm ayarını ve ilk satış anını (posStart, boşsa) yazabilir.

alter table public.cirak_pin_deneme add column if not exists locks int not null default 0;

create or replace function public.cirak_pin_check(p_uid uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare h text; d cirak_pin_deneme; maxf int := 5; wait_s int;
begin
  select pin_hash into h from user_pins where user_id = p_uid;
  if h is null then return jsonb_build_object('ok', false, 'reason', 'none'); end if;
  insert into cirak_pin_deneme(owner_id) values (p_uid) on conflict do nothing;
  select * into d from cirak_pin_deneme where owner_id = p_uid for update;
  if d.locked_until is not null and d.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'cool', 'wait', ceil(extract(epoch from (d.locked_until - now())))::int);
  end if;
  if h = crypt(coalesce(p_pin,''), h) then
    update cirak_pin_deneme set fails = 0, locks = 0, locked_until = null where owner_id = p_uid;
    return jsonb_build_object('ok', true);
  end if;
  if d.fails + 1 >= maxf then
    wait_s := case when d.locks <= 0 then 900 when d.locks = 1 then 3600 when d.locks = 2 then 21600 else 86400 end;
    update cirak_pin_deneme set fails = 0, locks = d.locks + 1, locked_until = now() + make_interval(secs => wait_s) where owner_id = p_uid;
    return jsonb_build_object('ok', false, 'reason', 'max', 'left', 0, 'wait', wait_s, 'notify', true, 'locks', d.locks + 1);
  end if;
  update cirak_pin_deneme set fails = d.fails + 1 where owner_id = p_uid;
  return jsonb_build_object('ok', false, 'reason', 'wrong', 'left', maxf - d.fails - 1);
end $function$;

-- Raftaki beklenen sayı (sunucuda): son çapa (sayım / boş raf / bitti / başlangıç stoğu) + gelen − fire/arıza/iade − satılan (iptal edilmemiş satışlar)
create or replace function public.stock_expected(p_shop uuid, p_pid text)
returns numeric language plpgsql stable security definer set search_path to 'public' as $function$
declare prod jsonb; a_t timestamptz; a_q numeric; t2 timestamptz; s numeric;
begin
  select data into prod from docs where shop_id = p_shop and kind = 'product' and id = p_pid and not deleted;
  if prod is null then return null; end if;
  if nullif(prod->>'initialStock','') is not null then
    a_t := coalesce(nullif(prod->>'createdAt','')::timestamptz, '-infinity'::timestamptz); a_q := (prod->>'initialStock')::numeric;
  end if;
  select (data->>'date')::timestamptz into t2 from docs
    where shop_id = p_shop and kind = 'event' and not deleted and data->>'type' = 'sayim' and data->>'productId' = p_pid
    order by (data->>'date')::timestamptz desc limit 1;
  if t2 is not null and (a_t is null or t2 >= a_t) then
    a_t := t2;
    select (data->>'qty')::numeric into a_q from docs
      where shop_id = p_shop and kind = 'event' and not deleted and data->>'type' = 'sayim' and data->>'productId' = p_pid and (data->>'date')::timestamptz = t2 limit 1;
  end if;
  select max((data->>'date')::timestamptz - make_interval(days => coalesce(nullif(data->>'days','')::int, 0))) into t2 from docs
    where shop_id = p_shop and kind = 'event' and not deleted and data->>'type' = 'bos' and data->>'productId' = p_pid;
  if t2 is not null and (a_t is null or t2 > a_t) then a_t := t2; a_q := 0; end if;
  if nullif(prod->>'outSince','') is not null then
    t2 := (prod->>'outSince')::timestamptz;
    if a_t is null or t2 > a_t then a_t := t2; a_q := 0; end if;
  end if;
  if a_t is null then return null; end if;
  s := a_q
    + coalesce((select sum(nullif(data->>'qty','')::numeric) from docs where shop_id = p_shop and kind = 'event' and not deleted
        and data->>'productId' = p_pid and data->>'type' = 'gelen' and (data->>'date')::timestamptz >= a_t), 0)
    - coalesce((select sum(nullif(data->>'qty','')::numeric) from docs where shop_id = p_shop and kind = 'event' and not deleted
        and data->>'productId' = p_pid and data->>'type' in ('fire','ariza','iade') and (data->>'date')::timestamptz > a_t), 0)
    - coalesce((select sum(nullif(it->>'q','')::numeric) from docs d, jsonb_array_elements(coalesce(d.data->'it','[]'::jsonb)) it
        where d.shop_id = p_shop and d.kind = 'sale' and not d.deleted and not coalesce((d.data->>'x')::boolean, false)
          and it->>'p' = p_pid and (d.data->>'d')::timestamptz >= a_t), 0);
  return s;
exception when others then return null;   -- bozuk tarih vb.: bilinmiyor say
end $function$;
revoke all on function public.stock_expected(uuid, text) from public, anon, authenticated;

create or replace function public.docs_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  me uuid := auth.uid();
  o public.docs;
  win interval := interval '2 minutes';
  etype text; wasv numeric; qtyv numeric; expv numeric; i jsonb; ps numeric; sm numeric := 0; perm jsonb; pos_on boolean; ofound boolean;
  view_keys text[] := array['bigText','showDetails','theme'];
begin
  if me is null then return new; end if;
  if is_owner(new.shop_id) or is_admin() then return new; end if;
  if new.kind = 'settings' and new.id = 'staffperm' then
    raise exception 'YETKI: çırak yetkilerini sadece dükkân sahibi değiştirir' using errcode = 'P0001';
  end if;
  select data into perm from docs where shop_id = new.shop_id and kind = 'settings' and id = 'staffperm' and not deleted;
  perm := coalesce(perm, '{}'::jsonb);
  if new.kind = 'cash' then
    raise exception 'YETKI: kasa kaydını sadece dükkân sahibi değiştirebilir' using errcode = 'P0001';
  end if;
  select * into o from docs where shop_id = new.shop_id and kind = new.kind and id = new.id;
  ofound := found;
  if new.deleted = false then
    if new.kind = 'event' then
      etype := new.data->>'type';
      qtyv := nullif(new.data->>'qty','')::numeric;
      if (etype in ('fire','ariza') and not coalesce((perm->>'fire')::boolean,false)) or (etype = 'iade' and not coalesce((perm->>'iade')::boolean,false)) then
        raise exception 'YETKI: fire ve iade kaydını sadece dükkân sahibi girer' using errcode = 'P0001';
      end if;
      if etype in ('gelen','fire','ariza','iade','sayim') and (qtyv is null or qtyv < 0 or (etype <> 'sayim' and qtyv = 0)) then
        raise exception 'YETKI: miktar hatalı (eksi ya da sıfır olamaz)' using errcode = 'P0001';
      end if;
      if (etype in ('odeme','tborc','todeme') and coalesce(nullif(new.data->>'amount','')::numeric, 0) <= 0)
         or (etype = 'borc' and coalesce(nullif(new.data->>'amount','')::numeric, 0) = 0) then
        raise exception 'YETKI: tutar hatalı' using errcode = 'P0001';
      end if;
      if etype = 'sayim' and not coalesce((perm->>'azalt')::boolean,false) and not (ofound and o.data = new.data) then
        pos_on := exists (select 1 from docs where shop_id = new.shop_id and kind = 'settings' and id = 'main' and not deleted and nullif(data->>'posStart','') is not null);
        if pos_on then
          -- satış kullanan dükkân: beklenen sayı sunucuda hesaplanır, telefonun "was" değerine bakılmaz
          expv := stock_expected(new.shop_id, new.data->>'productId');
          if expv is not null and qtyv < expv - 0.001 then
            raise exception 'YETKI: stoğu azaltmayı sadece dükkân sahibi yapar' using errcode = 'P0001';
          end if;
        else
          -- satış kullanmayan (Bakkal Defteri) dükkân: raf tahmini telefonda yapılır; eski kural sürer
          wasv := nullif(new.data->>'was','')::numeric;
          if wasv is null or qtyv < wasv then
            raise exception 'YETKI: stoğu azaltmayı sadece dükkân sahibi yapar' using errcode = 'P0001';
          end if;
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
    elsif new.kind = 'settings' then
      -- çırak: sadece görünüm ayarları ve (boşsa) ilk satış anı
      if not ofound then
        if (coalesce(new.data,'{}'::jsonb) - view_keys - 'posStart' - 'dayW') <> '{}'::jsonb then
          raise exception 'YETKI: dükkân ayarlarını sadece dükkân sahibi değiştirir' using errcode = 'P0001';
        end if;
        return new;
      end if;
      if (coalesce(new.data,'{}'::jsonb) - view_keys - 'posStart') is distinct from (coalesce(o.data,'{}'::jsonb) - view_keys - 'posStart')
         or (nullif(o.data->>'posStart','') is not null and (new.data->>'posStart') is distinct from (o.data->>'posStart')) then
        raise exception 'YETKI: dükkân ayarlarını sadece dükkân sahibi değiştirir' using errcode = 'P0001';
      end if;
      return new;
    end if;
  end if;
  if not ofound then
    if new.kind = 'product' and not new.deleted and not coalesce((perm->>'fiyat')::boolean,false) and (coalesce(nullif(new.data->>'salePrice','')::numeric,0) > 0 or coalesce(nullif(new.data->>'buyPrice','')::numeric,0) > 0) then
      raise exception 'YETKI: ürün fiyatını sadece dükkân sahibi yazar' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.kind = 'product' and not new.deleted and not coalesce((perm->>'fiyat')::boolean,false) and (coalesce(nullif(new.data->>'salePrice','')::numeric,0) <> coalesce(nullif(o.data->>'salePrice','')::numeric,0) or coalesce(nullif(new.data->>'buyPrice','')::numeric,0) <> coalesce(nullif(o.data->>'buyPrice','')::numeric,0)) then
    raise exception 'YETKI: fiyatı sadece dükkân sahibi değiştirebilir' using errcode = 'P0001';
  end if;
  if o.updated_by = me and o.updated_at > now() - win then return new; end if;
  if new.kind = 'product' and new.deleted = false then return new; end if;
  if new.kind = 'customer' and not new.deleted and coalesce((perm->>'musteri')::boolean,false) then return new; end if;
  if new.deleted and new.kind not in ('cash','settings','supplier') and coalesce((perm->>'sil')::boolean,false) then return new; end if;
  raise exception 'YETKI: bu kaydı değiştirme ya da silme yetkin yok' using errcode = 'P0001';
end $function$;
