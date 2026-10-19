-- Kendin Anlat (yapay zekâ ile duyuru): iş kuyruğu ve limitler. Canlı veritabanında uygulandı.
-- Yazma sadece sunucu fonksiyonundan (service role) yapılır; uygulama sadece kendi dükkânının işlerini okur.
-- Limit kaydı yoksa varsayılan: günde 3, ayda 20 üretim. Değiştirmek için:
--   insert into ai_limits (shop_id, daily, monthly) values ('<dükkân id>', 10, 100)
--   on conflict (shop_id) do update set daily = excluded.daily, monthly = excluded.monthly;
-- Kapatmak için: ... values ('<dükkân id>', ...) ve enabled = false.

create table if not exists public.ai_limits (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  enabled boolean not null default true,
  daily int not null default 3,
  monthly int not null default 20
);
create table if not exists public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null,
  prompt text not null,
  status text not null default 'bekliyor' check (status in ('bekliyor','calisiyor','bitti','hata')),
  mode text,
  steps jsonb not null default '[]'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists ai_jobs_shop_at on public.ai_jobs (shop_id, created_at desc);
alter table public.ai_limits enable row level security;
alter table public.ai_jobs enable row level security;
revoke all on public.ai_limits, public.ai_jobs from anon, authenticated;
grant select on public.ai_jobs to authenticated;
create policy ai_jobs_read on public.ai_jobs for select to authenticated using (is_owner(shop_id) or is_admin());
-- ai_begin(p_uid, p_shop, p_prompt): sahip kontrolü + günlük/aylık limit + tek eşzamanlı iş; sadece service role çağırır.
-- (Gövdesi canlı veritabanında; supabase/functions/reklam/index.ts bu fonksiyonu çağırır.)

-- ai_kalan(p_shop): Kendin Anlat ekranı kalan hakkı önceden gösterir; sadece sahip/yönetici.
-- Döner: {enabled, daily, monthly, daily_left, monthly_left}. (Gövdesi canlı veritabanında.)
-- grant execute on function public.ai_kalan(uuid) to authenticated;

-- ai_begin'i yalnızca edge function (service role) çağırır; yetki açıkça verilmeli:
grant execute on function public.ai_begin(uuid, uuid, text) to service_role;

-- Edge function tablolara service_role ile erişir; yetki açıkça verilmeli:
grant select, insert, update on public.ai_jobs to service_role;
grant select on public.ai_limits to service_role;

-- Sesli komut (asistan fonksiyonu): dükkân üyesi (sahip/çırak) için dükkân başına günde 150 çağrı.
-- ai_calls tablosu + ai_call_begin(p_uid, p_shop, p_kind 'sat'|'urun'|'ask'); sadece service_role çağırır.
-- create table public.ai_calls (id bigserial primary key, shop_id uuid not null references public.shops(id) on delete cascade,
--   user_id uuid not null, kind text not null, created_at timestamptz not null default now());
-- grant select, insert on public.ai_calls to service_role; grant usage, select on sequence public.ai_calls_id_seq to service_role;
-- (ai_call_begin gövdesi canlı veritabanında; üyelik + günlük sayım kontrolü yapar.)
