// Çırak modu: sahip telefonu çırağa bırakırken aynı telefonda çırağın KENDİ oturumuna geçer (gir);
// sahibe dönüş yalnızca sahibin PIN'i sunucuda doğrulanınca yapılır (don). Sahibin gizli bilgisi telefonda kalmaz.
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

  if (act === "don") {
    if (!sid) return j({ error: "Geçersiz oturum." }, 400);
    const { data: row } = await db.from("cirak_oturum").select("*").eq("sid", sid).eq("staff_id", uid).maybeSingle();
    if (!row) return j({ error: "Bu oturum çırak modunda değil." }, 403);
    const pin = String(b.pin || "");
    if (!/^\d{4}$/.test(pin)) return j({ ok: false, reason: "wrong" });
    const { data: chk, error } = await db.rpc("cirak_pin_check", { p_uid: row.owner_id, p_pin: pin });
    if (error) { console.log("pin_check hata", error.message); return j({ error: "Sunucu hazır değil." }, 500); }
    if (!chk?.ok) return j(chk || { ok: false, reason: "wrong" });
    const th = await linkFor(row.owner_id);
    if (!th) return j({ error: "Sahip hesabına geçilemedi (" + linkErr.slice(0, 120) + ")." }, 500);
    await db.from("cirak_oturum").delete().eq("nonce", row.nonce);
    try { await db.auth.admin.signOut(token, "local"); } catch (_) { /* oturum zaten kapanmış olabilir */ }
    return j({ ok: true, token_hash: th });
  }
  return j({ error: "Bilinmeyen işlem." }, 400);
}
