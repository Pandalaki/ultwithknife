// Discord sends people back here after they approve
import { verify, sign, cookies, cookie } from "../lib/kult.mjs";

const back = (ret, msg) => new Response(null, { status: 302, headers: { location: ret + (msg ? (ret.includes("?") ? "&" : "?") + "signin=" + msg : ""), "cache-control": "no-store", "set-cookie": cookie("kult_state", "", 0) } });

export default async (req) => {
  const url = new URL(req.url);
  const st = verify(cookies(req).kult_state);
  const ret = (st && st.ret) || "/lab/";
  const hash = ret.indexOf("#"), path = hash < 0 ? ret : ret.slice(0, hash), frag = hash < 0 ? "" : ret.slice(hash);
  const fail = m => back(path + (path.includes("?") ? "&" : "?") + "signin=" + m + frag, "");
  if (!st || st.exp < Date.now() || st.state !== url.searchParams.get("state")) return fail("expired");
  const code = url.searchParams.get("code");
  if (!code) return fail("cancelled");
  try {
    const tok = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: `${url.origin}/api/auth/callback`
      })
    }).then(r => r.ok ? r.json() : Promise.reject(new Error("token " + r.status)));
    const me = await fetch("https://discord.com/api/users/@me", { headers: { authorization: "Bearer " + tok.access_token } })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("me " + r.status)));
    const user = { id: me.id, name: (me.global_name || me.username || "Kult member").slice(0, 32), avatar: me.avatar || null, exp: Date.now() + 30 * 864e5 };
    const h = new Headers({ location: path + frag, "cache-control": "no-store" });
    h.append("set-cookie", cookie("kult_s", sign(user), 30 * 86400));
    h.append("set-cookie", cookie("kult_state", "", 0));
    return new Response(null, { status: 302, headers: h });
  } catch (e) {
    console.error("discord sign-in failed", e);
    return fail("failed");
  }
};
export const config = { path: "/api/auth/callback" };
