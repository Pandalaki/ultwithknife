// Issued when a signed-in player starts a game; the score must come back with it
import { sessionUser, sign, json, isGame, randomId } from "../lib/kult.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const user = sessionUser(req);
  if (!user) return json({ error: "signin" }, 401);
  const { game } = await req.json().catch(() => ({}));
  if (!isGame(game)) return json({ error: "game" }, 400);
  return json({ run: sign({ u: user.id, g: game, t: Date.now(), n: randomId() }) });
};
export const config = { path: "/api/run/start" };
