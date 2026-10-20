-- KAN-37: Çırak alış fiyatı/satışları görebilir (gizlenmedi); bunun yerine çırağın HER kaydı anında dükkân sahibine bildirilir.
-- Bildirim sunucudan gider (telefonda kapatılamaz, API ile yapılan değişiklikler de yakalanır):
-- docs tablosuna çırak bir kayıt yazınca/değiştirince/silince pg_net ile bildir fonksiyonu çağrılır; bildir sadece sahibin
-- "Çırağın yaptığı işlemler" bildirimini açtığı cihazlarına gönderir.

-- Sahip cihazları (bildir fonksiyonu gizli anahtarla çağırır)
create or replace function public.push_staff_event_targets(p_key text, p_shop uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
begin
  if p_key is null or p_key is distinct from (select val from app_secrets where name = 'cron') then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'subs', coalesce((
    select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'app', s.app)) from (
      select ps.endpoint, ps.p256dh, ps.auth, ps.app from push_subs ps
      join members m on m.shop_id = ps.shop_id and m.user_id = ps.user_id and m.role = 'owner'
      where ps.shop_id = p_shop and 'calisan' = any(ps.types) limit 60) s), '[]'::jsonb));
end $function$;
revoke all on function public.push_staff_event_targets(text, uuid) from public, anon, authenticated;
grant execute on function public.push_staff_event_targets(text, uuid) to service_role;

create or replace function public.docs_staff_notify()
returns trigger language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare who text; prod text; anon text;
begin
  if new.updated_by is null then return new; end if;
  if not exists (select 1 from members where shop_id = new.shop_id and user_id = new.updated_by and role = 'staff') then return new; end if;
  if tg_op = 'UPDATE' and old.data is not distinct from new.data and old.deleted = new.deleted then return new; end if;   -- aynı kaydın tekrar gönderilmesi
  select coalesce(nullif(full_name,''), username) into who from profiles where user_id = new.updated_by;
  if new.kind = 'event' and coalesce(new.data->>'productId','-') <> '-' then
    select data->>'name' into prod from docs where shop_id = new.shop_id and kind = 'product' and id = new.data->>'productId';
  end if;
  -- herkese açık (anon) anahtar: gece rapor zamanlayıcısının kullandığıyla aynı
  select substring(command from 'Bearer ([A-Za-z0-9._-]+)') into anon from cron.job where jobname = 'bakkal-rapor-bildirimi';
  perform net.http_post(
    url := 'https://mvonvaoatjhfmezlidrv.supabase.co/functions/v1/bildir',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || coalesce(anon, '')),
    body := jsonb_build_object('type', 'calisan_an', 'key', (select val from app_secrets where name = 'cron'),
      'shop_id', new.shop_id, 'kind', new.kind, 'id', new.id, 'op', case when new.deleted then 'sil' when tg_op = 'INSERT' then 'yeni' else 'degisti' end,
      'who', coalesce(who, 'Çırak'), 'urun', prod,
      'data', case when new.kind in ('sale','event','product','customer','supplier','settings') then new.data else '{}'::jsonb end,
      'old', case when tg_op = 'UPDATE' and new.kind = 'product' then jsonb_build_object('salePrice', old.data->'salePrice', 'buyPrice', old.data->'buyPrice', 'name', old.data->'name') else null end));
  return new;
exception when others then
  return new;   -- bildirim gönderilemese de kayıt bozulmasın
end $function$;

create trigger docs_staff_notify after insert or update on public.docs for each row execute function public.docs_staff_notify();
