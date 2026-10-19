-- Çırak modu (sunucu tarafı). Canlıda "cirak_modu" göçü olarak uygulandı; edge function: functions/cirak.
create table if not exists public.cirak_oturum (
  nonce uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  staff_id uuid not null references auth.users(id) on delete cascade,
  sid text,
  created_at timestamptz not null default now()
);
alter table public.cirak_oturum enable row level security;
revoke all on public.cirak_oturum from anon, authenticated;
grant all on public.cirak_oturum to service_role;
-- cirak_pin_check(p_uid, p_pin): verify_my_pin ile aynı mantık (5 yanlışta 5 dk bekleme), sadece service_role çağırır.
