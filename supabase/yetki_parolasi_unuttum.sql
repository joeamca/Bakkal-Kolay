-- Yetki parolasını unuttum: dükkân sahibine e-postayla giriş bağlantısı gider; bağlantıyla gelen (taze e-posta girişli)
-- oturum yeni yetki parolası belirleyebilir. Çırak modundan sahibe dönüşte açılan oturum sayılmaz (cirak fonksiyonu
-- dönüşte bekleyen isteği siler; istek zamanından ÖNCE açılan oturumlar da sayılmaz).
create table if not exists public.perm_resets (
  shop_id uuid not null,
  user_id uuid not null,
  requested_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);
alter table public.perm_resets enable row level security;   -- doğrudan erişim yok, sadece aşağıdaki fonksiyonlar

-- bu oturum e-postadaki bağlantıyla mı açıldı? (o girişin zamanı; değilse null)
create or replace function public.jwt_email_login_at()
returns timestamptz language sql stable set search_path to 'public' as $function$
  select to_timestamp(max((x->>'timestamp')::bigint))
  from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) x
  where x->>'method' in ('otp', 'magiclink', 'recovery');
$function$;

create or replace function public.perm_reset_start(p_shop uuid)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare r perm_resets; em text;
begin
  if auth.uid() is null or not is_owner(p_shop) then raise exception 'Sadece dükkân sahibi.' using errcode = '42501'; end if;
  select email into em from auth.users where id = auth.uid();
  if em is null or em like '%@kullanici.bakkaldefteri.app' then return jsonb_build_object('ok', false, 'reason', 'noemail'); end if;
  select * into r from perm_resets where shop_id = p_shop and user_id = auth.uid();
  if r.requested_at is not null and r.requested_at > now() - interval '60 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'cool', 'wait', ceil(extract(epoch from (r.requested_at + interval '60 seconds' - now())))::int);
  end if;
  insert into perm_resets (shop_id, user_id) values (p_shop, auth.uid())
  on conflict (shop_id, user_id) do update set requested_at = now();
  return jsonb_build_object('ok', true);
end $function$;

create or replace function public.perm_reset_state(p_shop uuid)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare r perm_resets; t timestamptz := jwt_email_login_at();
begin
  if auth.uid() is null or not is_owner(p_shop) then return jsonb_build_object('ready', false); end if;
  select * into r from perm_resets where shop_id = p_shop and user_id = auth.uid();
  return jsonb_build_object('ready', r.requested_at is not null and r.requested_at > now() - interval '1 hour' and t is not null and t >= r.requested_at - interval '5 seconds');
end $function$;

create or replace function public.perm_reset_finish(p_shop uuid, p_new text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare r perm_resets; t timestamptz := jwt_email_login_at(); mine text;
begin
  if auth.uid() is null or not is_owner(p_shop) then raise exception 'Sadece dükkân sahibi.' using errcode = '42501'; end if;
  select * into r from perm_resets where shop_id = p_shop and user_id = auth.uid() for update;
  if not (r.requested_at is not null and r.requested_at > now() - interval '1 hour' and t is not null and t >= r.requested_at - interval '5 seconds') then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if coalesce(char_length(p_new), 0) < 6 or char_length(p_new) > 30 then raise exception 'Yetki parolası en az 6 karakter olmalı.' using errcode = 'P0001'; end if;
  select pin_hash into mine from user_pins where user_id = auth.uid();
  if mine is not null and mine = crypt(p_new, mine) then raise exception 'Yetki parolası ekran kilidi PIN''inden farklı olmalı.' using errcode = 'P0001'; end if;
  insert into perm_pins (shop_id, pin_hash, set_by) values (p_shop, crypt(p_new, gen_salt('bf')), auth.uid())
  on conflict (shop_id) do update set pin_hash = excluded.pin_hash, fails = 0, locked_until = null, set_at = now(), set_by = auth.uid();
  delete from perm_resets where shop_id = p_shop and user_id = auth.uid();
  return jsonb_build_object('ok', true);
end $function$;

revoke all on function public.perm_reset_start(uuid), public.perm_reset_state(uuid), public.perm_reset_finish(uuid, text), public.jwt_email_login_at() from public, anon;
grant execute on function public.perm_reset_start(uuid), public.perm_reset_state(uuid), public.perm_reset_finish(uuid, text) to authenticated;
