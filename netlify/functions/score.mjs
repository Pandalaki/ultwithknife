// A finished run: check it, save the player's weekly best, update Discord
import { getStore } from "@netlify/blobs";
import { sessionUser, verify, json, isGame, plausible, weekId, recordScore, rankOf, syncBoard, announceTop, avatarUrl } from "../lib/kult.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const user = sessionUser(req);
  if (!user) return json({ error: "signin" }, 401);
  const body = await req.json().catch(() => ({}));
  const { game, run } = body;
  const score = Number(body.score), level = body.level == null ? null : Number(body.level);
  if (!isGame(game)) return json({ error: "game" }, 400);
  const ticket = verify(run);
  if (!ticket || ticket.u !== user.id || ticket.g !== game) return json({ error: "run" }, 400);

  const why = plausible(game, score, game === "throw" ? level : null, Date.now() - ticket.t);
  if (why) { console.warn("rejected score", user.id, game, score, level, why); return json({ error: "rejected", why }, 422); }

  const store = getStore("leaderboard");
  // one submit per run, and no spamming
  const pkey = `player/${user.id}`;
  const p = (await store.get(pkey, { type: "json" })) || {};
  if (p.lastRun && ticket.t <= p.lastRun) return json({ error: "used" }, 409);
  if (p.lastAt && Date.now() - p.lastAt < 4000) return json({ error: "slow down" }, 429);
  await store.setJSON(pkey, { lastRun: ticket.t, lastAt: Date.now(), name: user.name });

  const week = weekId();
  const res = await recordScore(store, game, week, user, Math.floor(score), game === "throw" ? Math.floor(level) : null);
  const rank = rankOf(res.data, user.id);

  if (res.improved) {
    const inTop = res.after.some(r => r.id === user.id);
    const wasTop = res.before.some(r => r.id === user.id);
    try {
      if (inTop || wasTop) await syncBoard(store, game, week, res.after);
      const newKing = res.after[0] && res.after[0].id === user.id && (!res.before[0] || res.before[0].id !== user.id);
      if (newKing) await announceTop(game, user, res.mine.score, res.mine.level);
    } catch (e) { console.error("discord update failed", e); }
  }
  return json({ ok: true, improved: res.improved, rank, best: res.mine.score, bestLevel: res.mine.level, top: res.after.map(r => ({ ...r, avatar: avatarUrl(r) })) });
};
export const config = { path: "/api/score" };
