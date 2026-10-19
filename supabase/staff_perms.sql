-- Çırak yetkileri: sahibin Ayarlar'dan açıp kapattığı liste + ayrı "yetki parolası".
-- Yetkiler docs tablosunda kind='settings', id='staffperm' kaydında durur. Sadece sahip yazar.
-- Yetki parolası ekran kilidi PIN'inden farklıdır; sunucuda hash olarak tutulur, yanlış sayısı sunucuda sayılır.

create table if not exists public.perm_pins (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  pin_hash text not null,
  fails int not null default 0,
  locked_until timestamptz,
  set_at timestamptz not null default now(),
  set_by uuid
);
alter table public.perm_pins enable row level security;
revoke all on public.perm_pins from anon, authenticated;   -- hiçbir politika yok: sadece aşağıdaki fonksiyonlar erişir

create or replace function public.perm_pin_info(p_shop uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null or not (is_owner(p_shop) or is_admin()) then raise exception 'Sadece dükkân sahibi.' using errcode = '42501'; end if;
  return jsonb_build_object('set', exists(select 1 from perm_pins where shop_id = p_shop));
end $$;

create or replace function public.perm_pin_check(p_shop uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r perm_pins;
begin
  if auth.uid() is null or not (is_owner(p_shop) or is_admin()) then raise exception 'Sadece dükkân sahibi.' using errcode = '42501'; end if;
  select * into r from perm_pins where shop_id = p_shop for update;
  if r.shop_id is null then return jsonb_build_object('ok', false, 'reason', 'none'); end if;
  if r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'cool', 'wait', ceil(extract(epoch from (r.locked_until - now())))::int);
  end if;
  if r.pin_hash = crypt(coalesce(p_pin, ''), r.pin_hash) then
    update perm_pins set fails = 0, locked_until = null where shop_id = p_shop;
    return jsonb_build_object('ok', true);
  end if;
  if r.fails + 1 >= 3 then   -- 3. yanlış: 5 dk kilit + istemci sahibe bildirim yollar
    update perm_pins set fails = 0, locked_until = now() + interval '5 minutes' where shop_id = p_shop;
    return jsonb_build_object('ok', false, 'reason', 'max', 'left', 0, 'wait', 300, 'notify', true);
  end if;
  update perm_pins set fails = r.fails + 1 where shop_id = p_shop;
  return jsonb_build_object('ok', false, 'reason', 'wrong', 'left', 2 - r.fails);
end $$;

create or replace function public.perm_pin_set(p_shop uuid, p_new text, p_old text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r perm_pins; mine text;
begin
  if auth.uid() is null or not (is_owner(p_shop) or is_admin()) then raise exception 'Sadece dükkân sahibi.' using errcode = '42501'; end if;
  if coalesce(char_length(p_new), 0) < 6 or char_length(p_new) > 30 then raise exception 'Yetki parolası en az 6 karakter olmalı.' using errcode = 'P0001'; end if;
  select pin_hash into mine from user_pins where user_id = auth.uid();
  if mine is not null and mine = crypt(p_new, mine) then raise exception 'Yetki parolası ekran kilidi PIN''inden farklı olmalı.' using errcode = 'P0001'; end if;
  select * into r from perm_pins where shop_id = p_shop for update;
  if r.shop_id is not null then
    if r.locked_until is not null and r.locked_until > now() then return jsonb_build_object('ok', false, 'reason', 'cool'); end if;
    if r.pin_hash <> crypt(coalesce(p_old, ''), r.pin_hash) then
      update perm_pins set locked_until = case when r.fails + 1 >= 3 then now() + interval '5 minutes' end,
        fails = case when r.fails + 1 >= 3 then 0 else r.fails + 1 end where shop_id = p_shop;
      return jsonb_build_object('ok', false, 'reason', case when r.fails + 1 >= 3 then 'max' else 'wrong' end, 'notify', r.fails + 1 >= 3);
    end if;
  end if;
  insert into perm_pins (shop_id, pin_hash, set_by) values (p_shop, crypt(p_new, gen_salt('bf')), auth.uid())
  on conflict (shop_id) do update set pin_hash = excluded.pin_hash, fails = 0, locked_until = null, set_at = now(), set_by = auth.uid();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.perm_pin_info(uuid), public.perm_pin_check(uuid, text), public.perm_pin_set(uuid, text, text) from public, anon;
grant execute on function public.perm_pin_info(uuid), public.perm_pin_check(uuid, text), public.perm_pin_set(uuid, text, text) to authenticated;
