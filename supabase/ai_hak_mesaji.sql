-- Günlük yapay zekâ hakkı (dükkân başına 150 istek) dolunca mesaj isteğin türüne göre (uygulandı: ai_hak_mesaji)
create or replace function public.ai_call_begin(p_uid uuid, p_shop uuid, p_kind text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare d0 timestamptz; n int; lim constant int := 150;
begin
  if p_kind not in ('sat','urun','ask') then return jsonb_build_object('ok', false, 'reason', 'Bilinmeyen istek.'); end if;
  if not (exists (select 1 from members m join shops s on s.id = m.shop_id where m.shop_id = p_shop and m.user_id = p_uid and s.active)
          or exists (select 1 from profiles p where p.user_id = p_uid and p.is_admin)) then
    return jsonb_build_object('ok', false, 'reason', 'Bu dükkânda yetkin yok.');
  end if;
  d0 := date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul';
  select count(*) into n from ai_calls where shop_id = p_shop and created_at >= d0;
  if n >= lim then return jsonb_build_object('ok', false, 'reason',
    case when p_kind = 'ask' then 'Bugünlük asistan hakkı doldu. Yarın tekrar dene.' else 'Bugünlük sesli komut hakkı doldu. Yarın tekrar dene.' end); end if;
  insert into ai_calls (shop_id, user_id, kind) values (p_shop, p_uid, p_kind);
  return jsonb_build_object('ok', true, 'left', lim - n - 1);
end $function$;
