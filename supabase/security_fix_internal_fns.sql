-- 2026-10-19 güvenlik düzeltmesi (Supabase'e migration olarak uygulandı).
-- Sorun: bd_report_items(... p_app), push_report_shop(... p_app) ve push_targets(... p_app) yeni eklenen sürümleri
-- anon/authenticated için çalıştırılabilir kalmıştı. bd_report_items'a p_shop = null verilince TÜM dükkânların
-- günlük ciro/kâr değerleri ve push abonelik anahtarları döndürülebiliyordu. Bu işlevleri yalnızca edge function
-- (service_role) çağırır.
revoke execute on function public.bd_report_items(uuid, timestamptz, boolean, text) from public, anon, authenticated;
revoke execute on function public.push_report_shop(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.push_targets(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.bd_report_items(uuid, timestamptz, boolean, text) to service_role;
grant execute on function public.push_report_shop(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.push_targets(uuid, uuid, text, text, text, text) to service_role;
-- Tetikleyici işlevleri RPC olarak açık kalmasın
revoke execute on function public.docs_guard() from public, anon, authenticated;
revoke execute on function public.docs_log_fn() from public, anon, authenticated;
-- NOT: İleride p_app gibi yeni parametreli sürüm eklenince eski sürümün REVOKE'u yeni sürüme geçmez; her yeni sürüm için tekrar revoke edin.
