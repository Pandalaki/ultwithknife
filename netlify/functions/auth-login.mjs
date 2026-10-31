// Start "Sign in with Discord"
import { sign, randomId, cookie, secret } from "../lib/kult.mjs";

export default async (req) => {
  const url = new URL(req.url);
  if (!process.env.DISCORD_CLIENT_ID || !secret()) return new Response("Discord sign-in isn't set up yet.", { status: 503 });
  let ret = url.searchParams.get("return") || "/lab/";
  if (!ret.startsWith("/") || ret.startsWith("//")) ret = "/lab/";
  const state = randomId();
  const q = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    response_type: "code",
    redirect_uri: `${url.origin}/api/auth/callback`,
    scope: "identify",
    state,
    prompt: "none"
  });
  return new Response(null, {
    status: 302,
    headers: {
      location: "https://discord.com/oauth2/authorize?" + q,
      "set-cookie": cookie("kult_state", sign({ state, ret, exp: Date.now() + 600e3 }), 600),
      "cache-control": "no-store"
    }
  });
};
export const config = { path: "/api/auth/login" };
