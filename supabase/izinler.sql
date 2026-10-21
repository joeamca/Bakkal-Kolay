-- Tablo izinleri (Data API erişimi). 30 Ekim 2026'dan sonra Supabase yeni tablolara bu izinleri kendiliğinden vermiyor:
-- proje baştan kurulursa (yeni proje, test kopyası, db reset) kurulum dosyalarından SONRA bu dosya çalıştırılmalı.
-- Canlı veritabanındaki izinlerin birebir kopyası (21 Ekim 2026). Satır erişimini ayrıca RLS kuralları sınırlar.
-- Yeni tablo eklenirse izin satırı aynı değişikliğe ve buraya yazılmalı.
revoke all on all tables in schema public from anon, authenticated, service_role;

grant select on public.shops, public.profiles, public.members to authenticated, service_role;
grant select, insert, update on public.docs to authenticated;
grant select on public.docs_log to authenticated;
grant select on public.ai_jobs to authenticated;
grant select, insert, update on public.ai_jobs to service_role;
grant select on public.ai_limits to service_role;
grant select, insert on public.ai_calls to service_role;
grant select, insert, update, delete on public.cirak_oturum, public.cirak_pin_deneme to service_role;
grant select, delete on public.push_subs to service_role;
grant select on public.signup_requests to service_role;
-- perm_pins, user_pins, app_secrets: kimse doğrudan okuyamaz; sadece güvenli (security definer) fonksiyonlar kullanır.
