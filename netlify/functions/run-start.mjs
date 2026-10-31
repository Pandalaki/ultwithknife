// Issued when a player starts a game; the score must come back with it.
// Signed-out players get a ticket too, so a run can still be claimed after signing in (see run-finish).
import { sessionUser, sign, json, isGame, randomId } from "../lib/kult.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const user = sessionUser(req);
  const { game } = await req.json().catch(() => ({}));
  if (!isGame(game)) return json({ error: "game" }, 400);
  return json({ run: sign({ u: user ? user.id : null, g: game, t: Date.now(), n: randomId() }) });
};
export const config = { path: "/api/run/start" };
