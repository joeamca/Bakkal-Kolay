-- =====================================================================
--  Bakkal Defteri · Supabase veritabanı kurulumu
--  Supabase panelinde: SQL Editor → New query → bu dosyanın TAMAMINI
--  yapıştır → Run. Tekrar çalıştırmak zararsızdır (verileri silmez).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Kullanıcı adları bu alan adıyla e-postaya çevrilir (e-posta gönderilmez).
-- Uygulamadaki EMAIL_DOMAIN ile aynı olmalı.
create or replace function public.bd_email_domain() returns text
language sql immutable set search_path = public as $$ select 'kullanici.bakkaldefteri.app' $$;

-- ---------- Tablolar ----------
create table if not exists public.shops (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null
);

create table if not exists public.profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique check (username ~ '^[a-z0-9._-]{3,24}$'),
  full_name   text check (full_name is null or char_length(full_name) <= 60),
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz
);

-- Tek kullanımlık şifre: hesabı başkası açtıysa ya da şifre yenilendiyse ilk girişte değiştirmek zorunlu
alter table public.profiles add column if not exists must_change boolean not null default false;
alter table public.profiles add column if not exists temp_set_at timestamptz;
-- Tek kullanımlık şifre kaç dakika geçerli
create or replace function public.bd_temp_minutes() returns int language sql immutable set search_path = public as $$ select 5 $$;

-- Gerçek e-posta mı? (uygulamanın kendi uydurma adresleri sayılmaz)
create or replace function public.bd_valid_email(e text) returns boolean language sql immutable set search_path = public as $$
  select coalesce(e,'') ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' and char_length(e) <= 120
     and e not like '%@' || bd_email_domain()
$$;
create or replace function public.bd_real_email(e text) returns text language sql immutable set search_path = public as $$
  select case when e like '%@' || bd_email_domain() then null else e end
$$;

create table if not exists public.members (
  shop_id     uuid not null references public.shops(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner','staff')),
  created_at  timestamptz not null default now(),
  primary key (shop_id, user_id)
);
create index if not exists members_user on public.members(user_id);

-- Uygulamadaki her kayıt (ürün, fatura satırı, fire, veresiye, ayar) bir satır
create table if not exists public.docs (
  shop_id     uuid not null references public.shops(id) on delete cascade,
  kind        text not null check (kind in ('product','event','supplier','customer','settings')),
  id          text not null check (char_length(id) between 1 and 80),
  data        jsonb not null default '{}'::jsonb check (pg_column_size(data) < 200000),
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  primary key (shop_id, kind, id)
);
create index if not exists docs_shop_time on public.docs(shop_id, updated_at);
-- Satış (sale) ve kasa hareketi (cash) kayıtları da aynı tabloda; tarihe göre hızlı bulunsun
alter table public.docs drop constraint if exists docs_kind_check;
alter table public.docs add constraint docs_kind_check check (kind in ('product','event','supplier','customer','settings','sale','cash'));
create index if not exists docs_shop_kind_d on public.docs(shop_id, kind, (data->>'d')) where kind in ('sale','cash');

-- Kayıt başvuruları: bakkal kendi başvurur, yönetici onaylar. Şifre sadece şifrelenmiş (bcrypt) saklanır.
create table if not exists public.signup_requests (
  id            uuid primary key default gen_random_uuid(),
  shop_name     text not null check (char_length(shop_name) between 1 and 60),
  full_name     text not null check (char_length(full_name) between 1 and 60),
  phone         text check (phone is null or char_length(phone) <= 30),
  note          text check (note is null or char_length(note) <= 300),
  username      text not null check (username ~ '^[a-z0-9._-]{3,24}$'),
  password_hash text not null default '',
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references auth.users(id) on delete set null,
  shop_id       uuid references public.shops(id) on delete set null
);
create unique index if not exists signup_pending_user on public.signup_requests(username) where status = 'pending';
alter table public.signup_requests add column if not exists email text check (email is null or char_length(email) <= 120);

-- Hesaba özel PIN (telefonu açarken / bekleme kilidinde). Sadece şifrelenmiş (bcrypt) saklanır,
-- tabloya kimse doğrudan erişemez (yönetici dahil); sadece aşağıdaki fonksiyonlar.
create table if not exists public.user_pins (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  pin_hash     text not null,
  set_at       timestamptz not null default now(),
  mins         int not null default 60 check (mins in (15,30,60,240)),
  fails        int not null default 0,
  locked_until timestamptz
);

-- ---------- Yardımcılar ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin and not p.must_change from profiles p where p.user_id = auth.uid()), false)
$$;

-- Geçici (tek kullanımlık) şifreyle girilmişse: kendi şifresini koyana kadar hiçbir veriye erişim yok
create or replace function public.pw_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select not p.must_change from profiles p where p.user_id = auth.uid()), true)
$$;

create or replace function public.is_member(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m join shops sh on sh.id = m.shop_id
                 where m.shop_id = s and m.user_id = auth.uid() and sh.active) and pw_ok()
$$;

create or replace function public.is_owner(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m where m.shop_id = s and m.user_id = auth.uid() and m.role = 'owner') and pw_ok()
$$;

-- Kim yazdıysa o yazsın, saat sunucudan gelsin
create or replace function public.docs_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists docs_stamp on public.docs;
create trigger docs_stamp before insert or update on public.docs
  for each row execute function public.docs_stamp();

-- ---------- Güvenlik kuralları (RLS) ----------
alter table public.shops    enable row level security;
alter table public.profiles enable row level security;
alter table public.members  enable row level security;
alter table public.docs     enable row level security;
alter table public.signup_requests enable row level security; -- kural yok: tabloya sadece fonksiyonlar erişir
alter table public.user_pins enable row level security;       -- kural yok: tabloya sadece fonksiyonlar erişir

drop policy if exists shops_read on public.shops;
create policy shops_read on public.shops for select to authenticated
  using (public.is_admin() or exists (select 1 from public.members m where m.shop_id = shops.id and m.user_id = auth.uid()));

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated
  using (user_id = auth.uid() or public.is_member(shop_id) or public.is_admin());

drop policy if exists docs_read on public.docs;
create policy docs_read on public.docs for select to authenticated using (public.is_member(shop_id));
drop policy if exists docs_insert on public.docs;
create policy docs_insert on public.docs for insert to authenticated with check (public.is_member(shop_id));
drop policy if exists docs_update on public.docs;
create policy docs_update on public.docs for update to authenticated
  using (public.is_member(shop_id)) with check (public.is_member(shop_id));
-- Silme yok: kayıtlar "deleted" işaretiyle silinir ki diğer telefonlar da öğrensin.

-- Girişsiz ziyaretçi hiçbir tabloya dokunamaz; tablolara doğrudan yazma da kapalı
revoke all on public.shops, public.profiles, public.members, public.docs from anon;
revoke all on public.signup_requests, public.user_pins from anon, authenticated;
revoke insert, update, delete on public.shops, public.profiles, public.members from authenticated;
grant select on public.shops, public.profiles, public.members to authenticated;
grant select, insert, update on public.docs to authenticated;

-- ---------- Hesap açma (iç fonksiyon, dışarıdan çağrılamaz) ----------
drop function if exists public.bd_create_user_hashed(text, text, text);
create or replace function public.bd_create_user_hashed(p_username text, p_hash text, p_full_name text, p_email text default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  u text := lower(trim(p_username));
  uid uuid := gen_random_uuid();
  em text;
  re text := nullif(lower(trim(coalesce(p_email,''))), '');
begin
  if re is not null and not bd_valid_email(re) then
    raise exception 'E-posta adresi hatalı: %', re using errcode = 'P0001';
  end if;
  if u !~ '^[a-z0-9._-]{3,24}$' then
    raise exception 'Kullanıcı adı 3-24 karakter olmalı; sadece İngilizce harf, rakam, nokta, tire.' using errcode = 'P0001';
  end if;
  if coalesce(p_hash,'') !~ '^\$2[aby]\$' then
    raise exception 'Şifre bilgisi eksik.' using errcode = 'P0001';
  end if;
  if exists (select 1 from profiles where username = u) then
    raise exception 'Bu kullanıcı adı alınmış: %', u using errcode = 'P0001';
  end if;
  em := coalesce(re, u || '@' || bd_email_domain());
  if exists (select 1 from auth.users where lower(email) = em) then
    if re is not null then raise exception 'Bu e-posta ile açılmış bir hesap var: %', re using errcode = 'P0001'; end if;
    raise exception 'Bu kullanıcı adı alınmış: %', u using errcode = 'P0001';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em,
      p_hash, now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('username', u, 'full_name', p_full_name), now(), now(),
      '', '', '', '', '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (uid::text, uid, jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true), 'email', now(), now(), now());
  insert into profiles (user_id, username, full_name) values (uid, u, nullif(trim(p_full_name), ''));
  return uid;
end $$;
revoke all on function public.bd_create_user_hashed(text, text, text, text) from public, anon, authenticated;

drop function if exists public.bd_create_user(text, text, text);
create or replace function public.bd_create_user(p_username text, p_password text, p_full_name text, p_email text default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
begin
  if char_length(coalesce(p_password,'')) < 8 then
    raise exception 'Şifre en az 8 karakter olmalı.' using errcode = 'P0001';
  end if;
  if exists (select 1 from signup_requests where username = lower(trim(p_username)) and status = 'pending') then
    raise exception 'Bu kullanıcı adıyla bekleyen bir başvuru var: %', lower(trim(p_username)) using errcode = 'P0001';
  end if;
  declare uid uuid; begin
    uid := bd_create_user_hashed(p_username, crypt(p_password, gen_salt('bf')), p_full_name, p_email);
    update profiles set must_change = true, temp_set_at = now() where user_id = uid;
    return uid;
  end;
end $$;
revoke all on function public.bd_create_user(text, text, text, text) from public, anon, authenticated;

-- ---------- İlk yönetici (sadece SQL Editor'den, bir kez) ----------
-- Kullanım:  select public.bootstrap_admin('berk', 'güçlü-şifre', 'Berk', 'Berk''in dükkânı');
create or replace function public.bootstrap_admin(p_username text, p_password text, p_full_name text, p_shop_name text default null)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid; sid uuid;
begin
  if exists (select 1 from profiles where is_admin) then
    raise exception 'Yönetici zaten var.' using errcode = 'P0001';
  end if;
  uid := bd_create_user(p_username, p_password, p_full_name);
  update profiles set is_admin = true, must_change = false, temp_set_at = null where user_id = uid;
  if p_shop_name is not null then
    insert into shops (name, created_by) values (p_shop_name, uid) returning id into sid;
    insert into members (shop_id, user_id, role) values (sid, uid, 'owner');
  end if;
  return 'Yönetici hazır: ' || lower(p_username);
end $$;
revoke all on function public.bootstrap_admin(text, text, text, text) from public, anon, authenticated;

-- ---------- Uygulamanın çağırdığı fonksiyonlar ----------
-- Giriş yapan kişi: profil + dükkânları
create or replace function public.my_context() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', p.user_id, 'username', p.username, 'full_name', p.full_name, 'is_admin', p.is_admin, 'must_change', p.must_change,
    'temp_left', case when p.must_change then greatest(0, floor(extract(epoch from (p.temp_set_at + make_interval(mins => bd_temp_minutes()) - now()))))::int end,
    'email', (select bd_real_email(au.email) from auth.users au where au.id = p.user_id),
    'has_pin', exists (select 1 from user_pins x where x.user_id = p.user_id),
    'pin_set_at', (select x.set_at from user_pins x where x.user_id = p.user_id),
    'pin_mins', coalesce((select x.mins from user_pins x where x.user_id = p.user_id), 60),
    'pending_signups', case when p.is_admin then (select count(*) from signup_requests r where r.status = 'pending') else 0 end,
    'shops', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'role', m.role, 'active', s.active) order by s.name)
                        from members m join shops s on s.id = m.shop_id where m.user_id = p.user_id), '[]'::jsonb))
  from profiles p where p.user_id = auth.uid()
$$;

create or replace function public.touch() returns void
language sql security definer set search_path = public as $$
  update profiles set last_seen = now() where user_id = auth.uid()
$$;

-- Yönetici: yeni dükkân + sahibinin hesabı
drop function if exists public.admin_create_shop(text, text, text, text);
create or replace function public.admin_create_shop(p_shop_name text, p_username text, p_password text, p_full_name text, p_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid; sid uuid;
begin
  if not is_admin() then raise exception 'Bu işlem için yönetici olmalısın.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_shop_name,''))) = 0 then raise exception 'Dükkân adını yaz.' using errcode = 'P0001'; end if;
  insert into shops (name, created_by) values (trim(p_shop_name), auth.uid()) returning id into sid;
  uid := bd_create_user(p_username, p_password, p_full_name, p_email);
  insert into members (shop_id, user_id, role) values (sid, uid, 'owner');
  return sid;
end $$;

-- Dükkân sahibi ya da yönetici: çalışan ekler (rol: staff ya da owner)
drop function if exists public.add_member(uuid, text, text, text, text);
create or replace function public.add_member(p_shop uuid, p_username text, p_password text, p_full_name text, p_role text default 'staff', p_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not (is_owner(p_shop) or is_admin()) then raise exception 'Bu dükkâna kişi ekleme yetkin yok.' using errcode = '42501'; end if;
  if p_role not in ('owner','staff') then raise exception 'Rol hatalı.' using errcode = 'P0001'; end if;
  uid := bd_create_user(p_username, p_password, p_full_name, p_email);
  insert into members (shop_id, user_id, role) values (p_shop, uid, p_role);
  return uid;
end $$;

-- Dükkândaki kişiler (dükkânın her üyesi görebilir: kim ne girdi gösterimi için)
create or replace function public.shop_members(p_shop uuid)
returns table (user_id uuid, username text, full_name text, role text, last_seen timestamptz)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.username, p.full_name, m.role, p.last_seen
  from members m join profiles p on p.user_id = m.user_id
  where m.shop_id = p_shop and (is_member(p_shop) or is_admin())
  order by m.role, p.username
$$;

-- Şifre yenileme: yönetici herkesinkini; dükkân sahibi kendi dükkânındaki çalışanınkini
create or replace function public.reset_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if char_length(coalesce(p_password,'')) < 8 then raise exception 'Şifre en az 8 karakter olmalı.' using errcode = 'P0001'; end if;
  if not (is_admin() or (pw_ok() and exists (
      select 1 from members o join members t on t.shop_id = o.shop_id
      where o.user_id = auth.uid() and o.role = 'owner' and t.user_id = p_user and t.role = 'staff'))) then
    raise exception 'Bu kişinin şifresini değiştirme yetkin yok.' using errcode = '42501';
  end if;
  if exists (select 1 from profiles where user_id = p_user and is_admin) and p_user <> auth.uid() then
    raise exception 'Yöneticinin şifresi buradan değiştirilemez.' using errcode = '42501';
  end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_user;
  update profiles set must_change = (p_user <> auth.uid()), temp_set_at = case when p_user <> auth.uid() then now() end where user_id = p_user;
  -- Şifresi yenilenen kişi PIN'ini de yeniden belirler (PIN'ini unutan buradan döner)
  if p_user <> auth.uid() then delete from user_pins where user_id = p_user; end if;
end $$;

-- Kendi şifreni değiştir (tek kullanımlık şifreden sonra da bu kullanılır)
create or replace function public.change_my_password(p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare cur text;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın.' using errcode = '42501'; end if;
  if char_length(coalesce(p_password,'')) < 8 then raise exception 'Şifre en az 8 karakter olmalı.' using errcode = 'P0001'; end if;
  if exists (select 1 from profiles where user_id = auth.uid() and must_change
             and temp_set_at < now() - make_interval(mins => bd_temp_minutes()))
     and not coalesce(auth.jwt()->'amr', '[]'::jsonb) @> '[{"method":"recovery"}]'::jsonb then
    raise exception 'Tek kullanımlık şifrenin süresi doldu. Yöneticiden ya da dükkân sahibinden yeni şifre iste.' using errcode = 'P0001';
  end if;
  select encrypted_password into cur from auth.users where id = auth.uid();
  if cur is not null and cur = crypt(p_password, cur) then raise exception 'Yeni şifre eskisiyle aynı olamaz.' using errcode = 'P0001'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = auth.uid();
  update profiles set must_change = false, temp_set_at = null where user_id = auth.uid();
end $$;

-- Dükkândan çıkar (başka dükkânı yoksa hesabı tamamen kapatır)
create or replace function public.remove_member(p_shop uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r text;
begin
  select role into r from members where shop_id = p_shop and user_id = p_user;
  if r is null then return; end if;
  if p_user = auth.uid() then raise exception 'Kendini çıkaramazsın.' using errcode = 'P0001'; end if;
  if not (is_admin() or (is_owner(p_shop) and r = 'staff')) then
    raise exception 'Bu kişiyi çıkarma yetkin yok.' using errcode = '42501';
  end if;
  delete from members where shop_id = p_shop and user_id = p_user;
  if not exists (select 1 from members where user_id = p_user)
     and not exists (select 1 from profiles where user_id = p_user and is_admin) then
    delete from auth.users where id = p_user;
  end if;
end $$;

-- Yönetici: dükkânı durdur / aç (ör. ödeme yapılmadıysa). Durdurulan dükkânın verisi silinmez.
create or replace function public.admin_set_shop_active(p_shop uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Bu işlem için yönetici olmalısın.' using errcode = '42501'; end if;
  update shops set active = p_active where id = p_shop;
end $$;

create or replace function public.rename_shop(p_shop uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_owner(p_shop) or is_admin()) then raise exception 'Yetkin yok.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_name,''))) = 0 then raise exception 'Dükkân adını yaz.' using errcode = 'P0001'; end if;
  update shops set name = trim(p_name) where id = p_shop;
end $$;

-- Yönetici paneli: dükkânlar, kişiler, son hareket. Dükkânın kayıtlarının İÇERİĞİ gösterilmez.
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Bu işlem için yönetici olmalısın.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x->>'name') from (
    select jsonb_build_object(
      'id', s.id, 'name', s.name, 'active', s.active, 'created_at', s.created_at,
      'products', (select count(*) from docs d where d.shop_id = s.id and d.kind = 'product' and not d.deleted),
      'events', (select count(*) from docs d where d.shop_id = s.id and d.kind = 'event' and not d.deleted),
      'last_write', (select max(updated_at) from docs d where d.shop_id = s.id),
      'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'username', p.username, 'full_name', p.full_name, 'role', m.role, 'last_seen', p.last_seen,
        'email', (select bd_real_email(au.email) from auth.users au where au.id = p.user_id),
        'temp', case when not p.must_change then null when p.temp_set_at < now() - make_interval(mins => bd_temp_minutes()) then 'expired' else 'waiting' end) order by m.role, p.username)
                  from members m join profiles p on p.user_id = m.user_id where m.shop_id = s.id), '[]'::jsonb)
    ) as x from shops s) t), '[]'::jsonb);
end $$;

-- Kendi e-postanı ekle / değiştir (şifreni unutunca bağlantı buraya gelir). Boş bırakılırsa silinir.
create or replace function public.set_my_email(p_email text)
returns text language plpgsql security definer set search_path = public as $$
declare e text := nullif(lower(trim(coalesce(p_email,''))), ''); u text;
begin
  if auth.uid() is null or not pw_ok() then raise exception 'Giriş yapmalısın.' using errcode = '42501'; end if;
  select username into u from profiles where user_id = auth.uid();
  if e is null then e := u || '@' || bd_email_domain();
  else
    if not bd_valid_email(e) then raise exception 'E-posta adresi hatalı.' using errcode = 'P0001'; end if;
    if exists (select 1 from auth.users where lower(email) = e and id <> auth.uid()) then
      raise exception 'Bu e-posta başka bir hesapta kayıtlı.' using errcode = 'P0001'; end if;
  end if;
  update auth.users set email = e, email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = auth.uid();
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', e), updated_at = now()
    where user_id = auth.uid() and provider = 'email';
  return bd_real_email(e);
end $$;

-- ---------- PIN ----------
-- PIN koy / değiştir. Kolay tahmin edilenler (1111, 1234, 4321...) kabul edilmez.
create or replace function public.set_my_pin(p_pin text, p_mins int default null)
returns timestamptz language plpgsql security definer set search_path = public, extensions as $$
declare t timestamptz := now(); d int[]; asc_ok boolean := true; desc_ok boolean := true; i int;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın.' using errcode = '42501'; end if;
  if not pw_ok() then raise exception 'Önce kendi şifreni belirle.' using errcode = '42501'; end if;
  if coalesce(p_pin,'') !~ '^[0-9]{4}$' then raise exception 'PIN 4 rakam olmalı.' using errcode = 'P0001'; end if;
  if p_mins is not null and p_mins not in (15,30,60,240) then raise exception 'Süre hatalı.' using errcode = 'P0001'; end if;
  select array_agg(substr(p_pin, g, 1)::int order by g) into d from generate_series(1,4) g;
  for i in 2..4 loop
    if d[i] <> d[i-1] + 1 then asc_ok := false; end if;
    if d[i] <> d[i-1] - 1 then desc_ok := false; end if;
  end loop;
  if p_pin ~ '^(.)\1{3}$' or asc_ok or desc_ok then
    raise exception 'Bu PIN çok kolay tahmin edilir. Başka bir PIN seç.' using errcode = 'P0001';
  end if;
  insert into user_pins (user_id, pin_hash, set_at, mins, fails, locked_until)
  values (auth.uid(), crypt(p_pin, gen_salt('bf')), t, coalesce(p_mins, 60), 0, null)
  on conflict (user_id) do update set pin_hash = excluded.pin_hash, set_at = t,
    mins = coalesce(p_mins, user_pins.mins), fails = 0, locked_until = null;
  return t;
end $$;

-- Kaç dakika boş kalınca kilitlensin
create or replace function public.set_my_pin_mins(p_mins int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_mins is null or p_mins not in (15,30,60,240) then raise exception 'Süre hatalı.' using errcode = 'P0001'; end if;
  update user_pins set mins = p_mins where user_id = auth.uid();
end $$;

-- PIN doğrula. 5 yanlışta 5 dakika bekletir.
create or replace function public.verify_my_pin(p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r user_pins; maxf int := 5;
begin
  if auth.uid() is null then raise exception 'Giriş yapmalısın.' using errcode = '42501'; end if;
  select * into r from user_pins where user_id = auth.uid() for update;
  if r.user_id is null then return jsonb_build_object('ok', false, 'reason', 'none'); end if;
  if r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'cool', 'wait', ceil(extract(epoch from (r.locked_until - now())))::int);
  end if;
  if r.pin_hash = crypt(coalesce(p_pin,''), r.pin_hash) then
    update user_pins set fails = 0, locked_until = null where user_id = auth.uid();
    return jsonb_build_object('ok', true, 'set_at', r.set_at, 'mins', r.mins);
  end if;
  if r.fails + 1 >= maxf then
    update user_pins set fails = 0, locked_until = now() + interval '5 minutes' where user_id = auth.uid();
    return jsonb_build_object('ok', false, 'reason', 'max', 'left', 0, 'wait', 300);
  end if;
  update user_pins set fails = r.fails + 1 where user_id = auth.uid();
  return jsonb_build_object('ok', false, 'reason', 'wrong', 'left', maxf - r.fails - 1);
end $$;

-- ---------- Satış ve kasa ----------
-- Stok için: telefonda tutulmayan eski satışların toplamı. p_req = [{"k":anahtar,"p":ürün,"s":başlangıç}], p_until hariç.
create or replace function public.pos_sold(p_shop uuid, p_req jsonb, p_until text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not is_member(p_shop) then raise exception 'Bu dükkânın kayıtlarına erişimin yok.' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_req,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_req,'[]'::jsonb)) > 5000 then
    raise exception 'İstek hatalı.' using errcode = 'P0001'; end if;
  -- satışlar bir kez taranır, ürünler eşleştirilir (ürün başına ayrı tarama yok)
  return coalesce((
    with r as (select x->>'k' k, x->>'p' p, x->>'s' s from jsonb_array_elements(p_req) x),
    it as (select d.data->>'d' dd, i->>'p' p, coalesce((i->>'q')::numeric, 0) q
           from docs d cross join lateral jsonb_array_elements(coalesce(d.data->'it','[]'::jsonb)) i
           where d.shop_id = p_shop and d.kind = 'sale' and not d.deleted and not coalesce((d.data->>'x')::boolean, false)
             and d.data->>'d' >= (select min(s) from r) and d.data->>'d' < p_until)
    select jsonb_object_agg(k, q) from (select r.k, sum(it.q) q from r join it on it.p = r.p and it.dd >= r.s group by r.k) t
  ), '{}'::jsonb);
end $$;

-- Rapor: gün / hafta / ay / yıl. Tarihler ISO (UTC) metni; p_to hariç. Saat dilimi İstanbul. Her kayıt türü bir kez taranır.
create or replace function public.pos_report(p_shop uuid, p_from text, p_to text, p_group text default 'day')
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare g text := case when p_group in ('day','week','month','year') then p_group else 'day' end; res jsonb;
begin
  if not is_member(p_shop) then raise exception 'Bu dükkânın kayıtlarına erişimin yok.' using errcode = '42501'; end if;
  with s as (
    select date_trunc(g, (d.data->>'d')::timestamptz at time zone 'Europe/Istanbul') k, coalesce(d.data->>'pay','nakit') pay,
           coalesce((d.data->>'tot')::numeric, 0) tot, coalesce((d.data->>'r')::boolean, false) iade, coalesce(d.data->'it','[]'::jsonb) it
    from docs d where d.shop_id = p_shop and d.kind = 'sale' and not d.deleted and not coalesce((d.data->>'x')::boolean, false)
      and d.data->>'d' >= p_from and d.data->>'d' < p_to),
  it as (select s.k, i->>'p' p, i->>'n' n, coalesce((i->>'q')::numeric,0) q, coalesce((i->>'u')::numeric,0) u, nullif(i->>'b','')::numeric b
         from s cross join lateral jsonb_array_elements(s.it) i),
  c as (select date_trunc(g, (d.data->>'d')::timestamptz at time zone 'Europe/Istanbul') k, d.data->>'d' ds, d.data->>'t' t,
               coalesce((d.data->>'a')::numeric, 0) a, d.data->>'r' r, d.data->>'n' n, nullif(d.data->>'say','')::numeric say
        from docs d where d.shop_id = p_shop and d.kind = 'cash' and not d.deleted and d.data->>'d' >= p_from and d.data->>'d' < p_to),
  o as (select date_trunc(g, (d.data->>'date')::timestamptz at time zone 'Europe/Istanbul') k, coalesce((d.data->>'amount')::numeric, 0) a
        from docs d where d.shop_id = p_shop and d.kind = 'event' and not d.deleted and d.data->>'type' = 'odeme'
          and d.data->>'date' >= p_from and d.data->>'date' < p_to),
  sa as (select k, count(*) filter (where not iade) fis, sum(tot) ciro, coalesce(sum(tot) filter (where iade),0) iade,
                coalesce(sum(tot) filter (where pay = 'nakit'),0) nakit, coalesce(sum(tot) filter (where pay = 'kart'),0) kart,
                coalesce(sum(tot) filter (where pay = 'veresiye'),0) veresiye from s group by k),
  ia as (select k, coalesce(sum(q*b) filter (where b is not null),0) maliyet, coalesce(sum(q*u) filter (where b is not null),0) ciro_bilinen from it group by k),
  ca as (select k, coalesce(sum(a) filter (where t = 'giris'),0) giris, coalesce(sum(a) filter (where t = 'cikis'),0) cikis from c group by k),
  oa as (select k, sum(a) tahsilat from o group by k),
  keys as (select k from sa union select k from ca union select k from oa),
  per as (select to_char(keys.k, 'YYYY-MM-DD') k, coalesce(sa.fis,0) fis, coalesce(sa.ciro,0) ciro, coalesce(sa.iade,0) iade,
                 coalesce(sa.nakit,0) nakit, coalesce(sa.kart,0) kart, coalesce(sa.veresiye,0) veresiye,
                 coalesce(ia.maliyet,0) maliyet, coalesce(ia.ciro_bilinen,0) ciro_bilinen, coalesce(oa.tahsilat,0) tahsilat,
                 coalesce(ca.giris,0) giris, coalesce(ca.cikis,0) cikis
          from keys left join sa on sa.k = keys.k left join ia on ia.k = keys.k left join ca on ca.k = keys.k left join oa on oa.k = keys.k)
  select jsonb_build_object(
    'group', g,
    'periods', coalesce((select jsonb_agg(to_jsonb(per) order by per.k) from per), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(x order by (x->>'ciro')::numeric desc) from (
        select jsonb_build_object('p', p, 'n', max(n), 'q', sum(q), 'ciro', sum(q*u),
          'maliyet', sum(q*b) filter (where b is not null), 'eksik', bool_or(b is null)) x from it group by p) t), '[]'::jsonb),
    'cash', coalesce((select jsonb_agg(jsonb_build_object('d', ds, 't', t, 'a', a, 'r', r, 'n', n, 'say', say) order by ds) from c), '[]'::jsonb),
    'reasons', coalesce((select jsonb_agg(jsonb_build_object('t', t, 'r', coalesce(r,'Diğer'), 'a', a, 'adet', adet) order by t, a desc) from (
        select t, r, sum(a) a, count(*) adet from c where t in ('giris','cikis') group by t, r) t), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- ---------- Kayıt başvurusu ----------
-- Herkes (girişsiz) başvurabilir. Sahte başvuru yağmuruna karşı sınır var.
drop function if exists public.request_signup(text, text, text, text, text, text);
-- Kullanıcı adını e-postadan üret (girişte e-posta kullanılır; kullanıcı adı sadece içeride)
create or replace function public.bd_free_username(p_base text) returns text
language plpgsql stable security definer set search_path = public as $$
declare b text := left(regexp_replace(lower(coalesce(p_base,'')), '[^a-z0-9._-]', '', 'g'), 20); c text; i int := 1;
begin
  if char_length(b) < 3 then b := rpad(b || 'bakkal', 6, 'x'); end if;
  c := b;
  while exists (select 1 from profiles where username = c) or exists (select 1 from signup_requests where username = c and status = 'pending') loop
    i := i + 1; c := b || i;
  end loop;
  return c;
end $$;
revoke all on function public.bd_free_username(text) from public, anon, authenticated;

create or replace function public.request_signup(p_shop_name text, p_full_name text, p_email text, p_password text, p_phone text default null, p_note text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare e text := lower(trim(coalesce(p_email,''))); ph text := nullif(trim(coalesce(p_phone,'')), ''); u text;
begin
  if char_length(trim(coalesce(p_shop_name,''))) = 0 then raise exception 'Dükkânının adını yaz.' using errcode = 'P0001'; end if;
  if char_length(trim(coalesce(p_full_name,''))) = 0 then raise exception 'Adını soyadını yaz.' using errcode = 'P0001'; end if;
  if char_length(trim(coalesce(p_shop_name,''))) > 60 or char_length(trim(p_full_name)) > 60 then raise exception 'Ad çok uzun.' using errcode = 'P0001'; end if;
  if not bd_valid_email(e) then raise exception 'E-posta adresini doğru yaz (örn. mert@gmail.com).' using errcode = 'P0001'; end if;
  if char_length(regexp_replace(coalesce(ph,''), '[^0-9]', '', 'g')) < 10 then raise exception 'Telefon numaranı yaz (onaylanınca sana haber verilecek).' using errcode = 'P0001'; end if;
  if char_length(coalesce(p_password,'')) < 8 then raise exception 'Şifre en az 8 karakter olmalı.' using errcode = 'P0001'; end if;
  if exists (select 1 from auth.users where lower(email) = e) or exists (select 1 from signup_requests where email = e and status = 'pending') then
    raise exception 'Bu e-posta ile bir hesap ya da bekleyen başvuru var. Şifreni unuttuysan giriş ekranındaki "Şifremi unuttum"u kullan.' using errcode = 'P0001';
  end if;
  if (select count(*) from signup_requests where created_at > now() - interval '10 minutes') >= 20
     or (select count(*) from signup_requests where status = 'pending') >= 300 then
    raise exception 'Şu an çok fazla başvuru var. Biraz sonra tekrar dene.' using errcode = 'P0001';
  end if;
  u := bd_free_username(split_part(e, '@', 1));
  insert into signup_requests (shop_name, full_name, phone, email, note, username, password_hash)
  values (trim(p_shop_name), trim(p_full_name), left(ph, 30), e, nullif(left(trim(coalesce(p_note,'')), 300), ''), u, crypt(p_password, gen_salt('bf')));
  return 'ok';
end $$;

-- Giriş olmadıysa: "başvurun onay bekliyor" diyebilmek için
create or replace function public.signup_status(p_username text) returns text
language sql stable security definer set search_path = public as $$
  select r.status from signup_requests r
  where (r.username = lower(trim(coalesce(p_username,''))) or r.email = lower(trim(coalesce(p_username,'')))) and r.status in ('pending','rejected')
    and not exists (select 1 from profiles p where p.username = r.username)
  order by r.created_at desc limit 1
$$;

-- Kullanıcı adıyla giremeyen kişiye ipucu: hesabı e-postaya bağlıysa adresin bir kısmını göster (b***@gmail.com)
create or replace function public.login_hint(p_login text) returns text
language sql stable security definer set search_path = public as $$
  select left(u.email, 1) || '***@' || split_part(u.email, '@', 2)
  from profiles p join auth.users u on u.id = p.user_id
  where p.username = lower(trim(coalesce(p_login,''))) and bd_real_email(u.email) is not null
$$;

-- Yönetici: bekleyen başvurular
create or replace function public.admin_signups() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Bu işlem için yönetici olmalısın.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'shop_name', r.shop_name, 'full_name', r.full_name, 'phone', r.phone,
      'note', r.note, 'username', r.username, 'email', r.email, 'created_at', r.created_at) order by r.created_at)
    from signup_requests r where r.status = 'pending'), '[]'::jsonb);
end $$;

-- Yönetici: onayla (dükkân + hesap açılır) ya da reddet
create or replace function public.admin_decide_signup(p_id uuid, p_approve boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r signup_requests; uid uuid; sid uuid;
begin
  if not is_admin() then raise exception 'Bu işlem için yönetici olmalısın.' using errcode = '42501'; end if;
  select * into r from signup_requests where id = p_id for update;
  if r.id is null then raise exception 'Başvuru bulunamadı.' using errcode = 'P0001'; end if;
  if r.status <> 'pending' then raise exception 'Bu başvuru zaten sonuçlanmış.' using errcode = 'P0001'; end if;
  if p_approve then
    uid := bd_create_user_hashed(r.username, r.password_hash, r.full_name, r.email);
    insert into shops (name, created_by) values (r.shop_name, auth.uid()) returning id into sid;
    insert into members (shop_id, user_id, role) values (sid, uid, 'owner');
  end if;
  update signup_requests set status = case when p_approve then 'approved' else 'rejected' end,
    decided_at = now(), decided_by = auth.uid(), shop_id = sid, password_hash = '' where id = p_id;
  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end,
    'username', r.username, 'email', r.email, 'full_name', r.full_name, 'shop_name', r.shop_name, 'phone', r.phone, 'shop_id', sid);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.request_signup(text,text,text,text,text,text)', 'public.signup_status(text)', 'public.login_hint(text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

-- Fonksiyon izinleri: girişsiz ziyaretçi hiçbirini çağıramaz
do $$
declare f text;
begin
  foreach f in array array[
    'public.my_context()', 'public.touch()',
    'public.admin_create_shop(text,text,text,text,text)', 'public.add_member(uuid,text,text,text,text,text)', 'public.set_my_email(text)',
    'public.shop_members(uuid)', 'public.reset_password(uuid,text)', 'public.remove_member(uuid,uuid)',
    'public.admin_set_shop_active(uuid,boolean)', 'public.rename_shop(uuid,text)', 'public.admin_overview()',
    'public.is_admin()', 'public.is_member(uuid)', 'public.is_owner(uuid)',
    'public.admin_signups()', 'public.admin_decide_signup(uuid,boolean)', 'public.change_my_password(text)', 'public.pw_ok()',
    'public.set_my_pin(text,integer)', 'public.set_my_pin_mins(integer)', 'public.verify_my_pin(text)',
    'public.pos_sold(uuid,jsonb,text)', 'public.pos_report(uuid,text,text,text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Supabase'in "otomatik RLS" ayarının yardımcı fonksiyonu dışarıdan çağrılmasın
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- ---------- Canlı eşitleme: bir telefonda girilen diğerinde hemen görünsün ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;


-- ===== Bildirimler (web push) =====
-- Her cihazın bildirim aboneliği. Tabloya doğrudan kimse erişemez; aşağıdaki fonksiyonlar ve sunucudaki bildirim servisi kullanır.
create table if not exists public.push_subs (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  shop_id    uuid references public.shops(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  app        text not null default 'tam' check (app in ('tam','kolay')),
  types      text[] not null default '{}',
  ua         text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subs_shop on public.push_subs(shop_id);
create index if not exists push_subs_user on public.push_subs(user_id);
alter table public.push_subs enable row level security;
revoke all on public.push_subs from anon, authenticated;

create or replace function public.push_save(p_shop uuid, p_endpoint text, p_p256dh text, p_auth text, p_app text, p_types text[], p_ua text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Giriş gerekli.' using errcode = '42501'; end if;
  if p_shop is not null and not public.is_member(p_shop) then raise exception 'Bu dükkânın kayıtlarına erişimin yok.' using errcode = '42501'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000
     or coalesce(char_length(p_p256dh), 0) not between 20 and 200 or coalesce(char_length(p_auth), 0) not between 8 and 100 then
    raise exception 'Bildirim kaydı hatalı.' using errcode = 'P0001'; end if;
  insert into push_subs (endpoint, user_id, shop_id, p256dh, auth, app, types, ua)
  values (p_endpoint, auth.uid(), p_shop, p_p256dh, p_auth, case when p_app = 'kolay' then 'kolay' else 'tam' end,
          coalesce((select array_agg(distinct t) from unnest(coalesce(p_types, '{}')) t where t in ('stok','bitti','kasa','cikis','veresiye','basvuru','rgun','rhafta','ray','tedarik')), '{}'),
          left(p_ua, 200))
  on conflict (endpoint) do update set user_id = excluded.user_id, shop_id = excluded.shop_id, p256dh = excluded.p256dh, auth = excluded.auth,
    app = excluded.app, types = excluded.types, ua = excluded.ua, updated_at = now();
  -- bir kişi en fazla 20 cihaz: en eskileri sil
  delete from push_subs where user_id = auth.uid() and endpoint in (
    select endpoint from push_subs where user_id = auth.uid() order by updated_at desc offset 20);
end $$;

create or replace function public.push_remove(p_endpoint text)
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from push_subs where endpoint = p_endpoint and user_id = auth.uid();
$$;

create or replace function public.push_get(p_endpoint text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('types', to_jsonb(types), 'app', app, 'shop_id', shop_id) from push_subs where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke all on function public.push_save(uuid, text, text, text, text, text[], text) from public, anon;
revoke all on function public.push_remove(text) from public, anon;
revoke all on function public.push_get(text) from public, anon;
grant execute on function public.push_save(uuid, text, text, text, text, text[], text) to authenticated;
grant execute on function public.push_remove(text) to authenticated;
grant execute on function public.push_get(text) to authenticated;

-- Bildirim servisi (sunucudaki "bildir" fonksiyonu) dükkân üyeliğini ve cihaz kayıtlarını okuyabilsin
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant select on public.members, public.shops, public.profiles, public.signup_requests to service_role;
    grant select, delete on public.push_subs to service_role;
  end if;
end $$;

-- Bildirim servisi (sunucudaki "bildir" fonksiyonu) için: tablolara genel izin vermeden, sadece gereken işi yapan fonksiyonlar.
create or replace function public.push_targets(p_uid uuid, p_shop uuid, p_type text, p_exclude text, p_endpoint text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from members m join shops s on s.id = m.shop_id where m.shop_id = p_shop and m.user_id = p_uid and s.active) then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'subs', coalesce((
    select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth, 'app', app)) from (
      select endpoint, p256dh, auth, app from push_subs
      where case when p_type = 'deneme' then user_id = p_uid and endpoint = p_endpoint
                 else shop_id = p_shop and p_type = any(types) and endpoint is distinct from p_exclude end
      limit 60) x), '[]'::jsonb));
end $$;

create or replace function public.push_admin_targets()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'yeni', (select count(*) from signup_requests where status = 'pending' and created_at > now() - interval '3 minutes'),
    'bekleyen', (select count(*) from signup_requests where status = 'pending'),
    'subs', coalesce((select jsonb_agg(jsonb_build_object('endpoint', x.endpoint, 'p256dh', x.p256dh, 'auth', x.auth, 'app', x.app))
      from push_subs x join profiles p on p.user_id = x.user_id where p.is_admin and 'basvuru' = any(x.types)), '[]'::jsonb));
$$;

create or replace function public.push_drop(p_endpoint text)
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from push_subs where endpoint = p_endpoint;
$$;

revoke all on function public.push_targets(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.push_admin_targets() from public, anon, authenticated;
revoke all on function public.push_drop(text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.push_targets(uuid, uuid, text, text, text) to service_role;
    grant execute on function public.push_admin_targets() to service_role;
    grant execute on function public.push_drop(text) to service_role;
  end if;
end $$;

-- ===== Rapor bildirimleri (gün / hafta / ay sonu) =====
-- Günün raporu, dükkân "Gün kapanışı"na basınca uygulamadan gider. Kapanış yapmayan dükkânlar için sunucunun zamanlayıcısı her akşam 23:30'da (Türkiye) bildirim servisini çağırır. Çağrıyı doğrulayan anahtar burada üretilir, kimse okuyamaz.
create table if not exists public.app_secrets (name text primary key, val text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
insert into public.app_secrets (name, val) values ('cron', encode(extensions.gen_random_bytes(24), 'hex')) on conflict (name) do nothing;

-- Raporu hesaplayan ortak fonksiyon. p_shop boşsa tüm dükkânlar; p_only_open doluysa bugün "Gün kapanışı" yapmış dükkânlar atlanır
-- (onlara rapor kapanış anında zaten gitti).
create or replace function public.bd_report_items(p_shop uuid, p_now timestamptz, p_only_open boolean)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare d date := (p_now at time zone 'Europe/Istanbul')::date; res jsonb := '[]'::jsonb; k record;
begin
  for k in select * from (values ('gun', 'rgun', d, d + 1), ('hafta', 'rhafta', d - 6, d + 1), ('ay', 'ray', date_trunc('month', d)::date, d + 1)) v(kind, typ, a, b)
           where kind = 'gun' or (kind = 'hafta' and extract(isodow from d) = 7) or (kind = 'ay' and extract(day from d + 1) = 1)
  loop
    res := res || coalesce((
      select jsonb_agg(jsonb_build_object('kind', k.kind, 'from', k.a, 'to', k.b - 1, 'shop', sh.id, 'name', sh.name,
        'ciro', coalesce(t.ciro, 0), 'fis', coalesce(t.fis, 0), 'kar', coalesce(t.kar, 0), 'subs', x.subs))
      from shops sh
      join lateral (select jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth, 'app', ps.app)) subs
                    from push_subs ps where ps.shop_id = sh.id and k.typ = any(ps.types)) x on x.subs is not null
      left join lateral (
        select sum((s.data->>'tot')::numeric) ciro, count(*) filter (where not coalesce((s.data->>'r')::boolean, false)) fis,
               sum((select coalesce(sum((i->>'q')::numeric * ((i->>'u')::numeric - (i->>'b')::numeric)), 0)
                    from jsonb_array_elements(coalesce(s.data->'it', '[]'::jsonb)) i where i ? 'b')) kar
        from docs s where s.shop_id = sh.id and s.kind = 'sale' and not s.deleted and not coalesce((s.data->>'x')::boolean, false)
          and (s.data->>'d')::timestamptz >= (k.a::timestamp at time zone 'Europe/Istanbul')
          and (s.data->>'d')::timestamptz <  (k.b::timestamp at time zone 'Europe/Istanbul')) t on true
      where sh.active and (p_shop is null or sh.id = p_shop)
        and (not p_only_open or not exists (
              select 1 from docs c where c.shop_id = sh.id and c.kind = 'cash' and not c.deleted and c.data->>'t' = 'kapanis'
                and (c.data->>'d')::timestamptz >= (d::timestamp at time zone 'Europe/Istanbul')))), '[]'::jsonb);
  end loop;
  return res;
end $$;

-- Yedek zamanlayıcı (23:30): sadece bugün günü kapatmamış dükkânlara gider
create or replace function public.push_report_targets(p_key text, p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_key is null or p_key is distinct from (select val from app_secrets where name = 'cron') then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'items', bd_report_items(null, p_now, true));
end $$;

-- Gün kapanışında uygulama çağırır: sadece kendi dükkânının raporu (üyelik kontrol edilir)
create or replace function public.push_report_shop(p_uid uuid, p_shop uuid, p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from members m join shops s on s.id = m.shop_id where m.shop_id = p_shop and m.user_id = p_uid and s.active) then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'items', bd_report_items(p_shop, p_now, false));
end $$;

revoke all on function public.bd_report_items(uuid, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.push_report_targets(text, timestamptz) from public, anon, authenticated;
revoke all on function public.push_report_shop(uuid, uuid, timestamptz) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.bd_report_items(uuid, timestamptz, boolean) to service_role;
    grant execute on function public.push_report_targets(text, timestamptz) to service_role;
    grant execute on function public.push_report_shop(uuid, uuid, timestamptz) to service_role;
  end if;
end $$;

-- Tedarikçiye ödeme zamanı: en eski ödenmemiş alım vadeyi geçince (sonra haftada bir) hatırlat
create or replace function public.push_supplier_targets(p_key text, p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_key is null or p_key is distinct from (select val from app_secrets where name = 'cron') then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    with ev as (
      select d.shop_id, d.data->>'supplierId' sid, coalesce(d.data->>'supName', d.data->>'supplierId') nm, d.data->>'type' t,
             coalesce((d.data->>'amount')::numeric, 0) a, (d.data->>'date')::timestamptz dt, d.id
      from docs d join shops sh on sh.id = d.shop_id and sh.active
      where d.kind = 'event' and not d.deleted and d.data->>'type' in ('tborc', 'todeme') and d.data->>'supplierId' is not null),
    paid as (select shop_id, sid, sum(a) p from ev where t = 'todeme' group by shop_id, sid),
    b as (select e.shop_id, e.sid, e.nm, e.dt, e.a, sum(e.a) over (partition by e.shop_id, e.sid order by e.dt, e.id rows unbounded preceding) cum
          from ev e where e.t = 'tborc'),
    agg as (select b.shop_id, b.sid, max(b.nm) nm, sum(b.a) - coalesce(max(p.p), 0) bal,
                   min(b.dt) filter (where b.cum > coalesce(p.p, 0) + 0.005) oldest
            from b left join paid p on p.shop_id = b.shop_id and p.sid = b.sid group by b.shop_id, b.sid),
    due as (select a.shop_id, a.sid, coalesce(s.data->>'name', a.nm) sname, a.bal,
                   coalesce(nullif(s.data->>'vade', '')::int, 15) vade, floor(extract(epoch from (p_now - a.oldest)) / 86400)::int age
            from agg a left join docs s on s.shop_id = a.shop_id and s.kind = 'supplier' and s.id = a.sid and not s.deleted
            where a.bal > 0.005 and a.oldest is not null)
    select jsonb_agg(jsonb_build_object('shop', d.shop_id, 'sid', d.sid, 'name', d.sname, 'bal', round(d.bal, 2), 'age', d.age, 'vade', d.vade, 'subs', x.subs))
    from due d join lateral (select jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth, 'app', ps.app)) subs
                             from push_subs ps where ps.shop_id = d.shop_id and 'tedarik' = any(ps.types)) x on x.subs is not null
    where d.age >= d.vade and (d.age - d.vade) % 7 = 0), '[]'::jsonb));
end $$;
revoke all on function public.push_supplier_targets(text, timestamptz) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.push_supplier_targets(text, timestamptz) to service_role;
  end if;
end $$;

-- Zamanlayıcı (Supabase'te hazır gelen pg_cron ve pg_net eklentileri)
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net with schema extensions;
    perform cron.schedule('bakkal-rapor-bildirimi', '30 20 * * *', $job$
      select net.http_post(
        url := 'https://mvonvaoatjhfmezlidrv.supabase.co/functions/v1/bildir',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12b252YW9hdGpoZm1lemxpZHJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4OTg0NjAsImV4cCI6MjEwNzQ3NDQ2MH0.Rwg4ZXS9XXLGKeM4eZb_hOYLbGDgL_o03yz4c8bkapA'),
        body := jsonb_build_object('type', 'rapor', 'key', (select val from public.app_secrets where name = 'cron')))
    $job$);
  end if;
end $$;

select 'Bakkal Defteri veritabanı hazır.' as sonuc;
