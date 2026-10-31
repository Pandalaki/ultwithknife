// A signed-out player finished a run: check it now (the time played is known now, not after sign-in)
// and hand back a signed claim the browser keeps until the player signs in. Claims expire after an hour.
import { verify, sign, json, isGame, plausible, weekId } from "../lib/kult.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const body = await req.json().catch(() => ({}));
  const { game, run } = body;
  const score = Number(body.score), level = body.level == null ? null : Number(body.level);
  if (!isGame(game)) return json({ error: "game" }, 400);
  const ticket = verify(run);
  if (!ticket || ticket.u !== null || ticket.g !== game) return json({ error: "run" }, 400);
  const lvl = game === "throw" ? level : null;
  const why = plausible(game, score, lvl, Date.now() - ticket.t);
  if (why) return json({ error: "rejected", why }, 422);
  const now = Date.now();
  return json({ claim: sign({ c: 1, g: game, n: ticket.n, s: Math.floor(score), l: lvl == null ? null : Math.floor(lvl), w: weekId(now), exp: now + 3600e3 }) });
};
export const config = { path: "/api/run/finish" };
