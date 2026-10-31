import { cookie } from "../lib/kult.mjs";
export default async () => new Response(null, { status: 302, headers: { location: "/lab/", "set-cookie": cookie("kult_s", "", 0), "cache-control": "no-store" } });
export const config = { path: "/api/auth/logout" };
