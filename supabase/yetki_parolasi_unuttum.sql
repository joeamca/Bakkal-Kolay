-- Yetki parolamı unuttum (uygulandı: yetki_parolasi_sifreyle_yenile)
-- Sahip giriş şifresini yeniden yazınca (son 5 dakikada şifreyle giriş) yeni yetki parolası koyabilir.
-- Çıraktan sahibe PIN ile dönüşte açılan oturum şifreyle açılmadığı için sayılmaz.
create or replace function public.perm_pin_reset(p_shop uuid, p_new text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare t timestamptz; mine text;
begin
  if auth.uid() is null or not is_owner(p_shop) then raise exception 'Sadece dükkân sahibi.' using errcode = '42501'; end if;
  select to_timestamp(max((x->>'timestamp')::bigint)) into t
    from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) x where x->>'method' = 'password';
  if t is null or t < now() - interval '5 minutes' then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if coalesce(char_length(p_new), 0) < 6 or char_length(p_new) > 30 then raise exception 'Yetki parolası en az 6 karakter olmalı.' using errcode = 'P0001'; end if;
  select pin_hash into mine from user_pins where user_id = auth.uid();
  if mine is not null and mine = crypt(p_new, mine) then raise exception 'Yetki parolası ekran kilidi PIN''inden farklı olmalı.' using errcode = 'P0001'; end if;
  insert into perm_pins (shop_id, pin_hash, set_by) values (p_shop, crypt(p_new, gen_salt('bf')), auth.uid())
  on conflict (shop_id) do update set pin_hash = excluded.pin_hash, fails = 0, locked_until = null, set_at = now(), set_by = auth.uid();
  return jsonb_build_object('ok', true);
end $function$;
revoke all on function public.perm_pin_reset(uuid, text) from public, anon;
grant execute on function public.perm_pin_reset(uuid, text) to authenticated;
