// Çırak modu: sahip telefonu çırağa bırakırken aynı telefonda çırağın KENDİ oturumuna geçer (gir);
// sahibe dönüş (çırak hesabından) yalnızca sahibin PIN'i sunucuda doğrulanınca yapılır (don; 5 yanlışta kilit, her kilitte bekleme uzar, sahibe bildirim). Sahibin gizli bilgisi telefonda kalmaz.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const j = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sidOf(token: string): string {
  try { const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return String(p.session_id || ""); } catch (_) { return ""; }
}

Deno.serve(async (req) => {
  try { return await handle(req); } catch (e) { console.log("cirak beklenmeyen hata", String(e)); return j({ error: "Sunucu hatası: " + String(e).slice(0, 160) }, 500); }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch (_) { /* boş gövde */ }
  const db = createClient(SUPA_URL, SRK, { auth: { persistSession: false } });
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(token);
  const uid = u?.user?.id;
  if (!uid) return j({ error: "Giriş gerekli." }, 401);
  const sid = sidOf(token);
  const act = String(b.action || "");

  // magic link ile o kullanıcı için tek kullanımlık giriş anahtarı üret
  let linkErr = "";
  const linkFor = async (userId: string) => {
    const { data: ue, error: e1 } = await db.auth.admin.getUserById(userId);
    const email = ue?.user?.email;
    if (!email) { linkErr = "kullanıcı bulunamadı " + (e1?.message || ""); console.log("getUserById hata", linkErr); return null; }
    const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
    if (error) { linkErr = error.message; console.log("generateLink hata", error.message); return null; }
    const th = data?.properties?.hashed_token || null;
    if (!th) linkErr = "anahtar üretilemedi";
    return th;
  };

  if (act === "gir") {
    const shop = String(b.shop_id || ""), staff = String(b.staff_id || "");
    if (!UUID.test(shop) || !UUID.test(staff)) return j({ error: "Çırak seçilmedi." }, 400);
    const { data: me } = await db.from("members").select("role").eq("shop_id", shop).eq("user_id", uid).maybeSingle();
    if (me?.role !== "owner") return j({ error: "Sadece dükkân sahibi çırak moduna geçebilir." }, 403);
    const { data: st } = await db.from("members").select("role").eq("shop_id", shop).eq("user_id", staff).maybeSingle();
    if (st?.role !== "staff") return j({ error: "Seçilen kişi bu dükkânın çırağı değil." }, 400);
    const { data: pin } = await db.from("user_pins").select("user_id").eq("user_id", uid).maybeSingle();
    if (!pin) return j({ error: "Önce PIN belirlemelisin." }, 400);
    await db.from("cirak_oturum").delete().lt("created_at", new Date(Date.now() - 30 * 86400000).toISOString());
    await db.from("cirak_oturum").delete().eq("owner_id", uid).eq("staff_id", staff).is("sid", null);
    const th = await linkFor(staff);
    if (!th) return j({ error: "Çırak hesabına geçilemedi (" + linkErr.slice(0, 120) + ")." }, 500);
    const { data: row, error } = await db.from("cirak_oturum").insert({ shop_id: shop, owner_id: uid, staff_id: staff }).select("nonce").single();
    if (error || !row) return j({ error: "Kaydedilemedi (" + String(error?.message || "").slice(0, 120) + ")." }, 500);
    return j({ token_hash: th, nonce: row.nonce });
  }

  if (act === "bagla") {   // çırak oturumu açıldı: bu oturum kimliğini sahibe dönüş hakkıyla eşle
    const nonce = String(b.nonce || "");
    if (!UUID.test(nonce) || !sid) return j({ error: "Geçersiz." }, 400);
    const { data: row } = await db.from("cirak_oturum").select("*").eq("nonce", nonce).eq("staff_id", uid).is("sid", null).maybeSingle();
    if (!row || Date.now() - new Date(row.created_at).getTime() > 5 * 60000) return j({ error: "Süre doldu, tekrar dene." }, 400);
    await db.from("cirak_oturum").update({ sid }).eq("nonce", nonce);
    return j({ ok: true });
  }

  if (act === "durum") {   // bu oturum çırak modunda mı?
    if (!sid) return j({ cirak: false });
    const { data: row } = await db.from("cirak_oturum").select("shop_id").eq("sid", sid).eq("staff_id", uid).maybeSingle();
    return j({ cirak: !!row });
  }

  if (act === "don") {   // çırak hesabından sahibe dönüş: dükkânın sahibinin PIN'i (ayrı, daha sıkı deneme sayacıyla) doğrulanır
    const shop = String(b.shop_id || "");
    if (!UUID.test(shop)) return j({ error: "Dükkân seçili değil." }, 400);
    const { data: me } = await db.from("members").select("role").eq("shop_id", shop).eq("user_id", uid).maybeSingle();
    if (me?.role !== "staff") return j({ error: "Bu işlem çırak hesabı içindir." }, 403);
    const pin = String(b.pin || "");
    if (!/^\d{4}$/.test(pin)) return j({ ok: false, reason: "wrong" });
    const { data: owners } = await db.from("members").select("user_id").eq("shop_id", shop).eq("role", "owner");
    let last: Record<string, unknown> = { ok: false, reason: "none" }, ownerId = "";
    for (const o of owners || []) {
      const { data: chk, error } = await db.rpc("cirak_pin_check", { p_uid: o.user_id, p_pin: pin });
      if (error) { console.log("pin_check hata", error.message); return j({ error: "Sunucu hazır değil." }, 500); }
      if (chk?.ok) { ownerId = o.user_id; break; }
      if (chk) last = chk;
    }
    if (!ownerId) {
      // 5 yanlışta kilit: dükkân sahibine bildirim (her kilitte bekleme uzar: 15 dk → 1 sa → 6 sa → 24 sa)
      if (last.notify) {
        const w = Number(last.wait || 0), sure = w >= 3600 ? `${Math.round(w / 3600)} saat` : `${Math.round(w / 60)} dakika`;
        try {
          await fetch(`${SUPA_URL}/functions/v1/bildir`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY") || "" },
            body: JSON.stringify({ type: "calisan", shop_id: shop, title: "Sahip PIN'i 5 kez yanlış girildi", body: `Çırak hesabından sahibe dönüş denendi; PIN ${sure} kilitlendi. Sen değilsen PIN'ini değiştir.`, tag: "pin-kilit" }) });
        } catch (e) { console.log("bildirim gönderilemedi", String(e).slice(0, 120)); }
      }
      return j(last);
    }
    const th = await linkFor(ownerId);
    if (!th) return j({ error: "Sahip hesabına geçilemedi (" + linkErr.slice(0, 120) + ")." }, 500);
    await db.from("cirak_oturum").delete().eq("staff_id", uid);
    try { await db.auth.admin.signOut(token, "local"); } catch (_) { /* oturum zaten kapanmış olabilir */ }
    return j({ ok: true, token_hash: th });
  }
  return j({ error: "Bilinmeyen işlem." }, 400);
}
