// Read-only feed for the KULT Discord bot. The bot polls this (every ~30s) and does all Discord posting itself.
// Auth: header "Authorization: Bearer <BOT_API_KEY>" (set the same value in Netlify and in the bot's secrets).
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import { json, weekId, weekStart, weekEnd, boardKey, top, rankOf, avatarUrl, GAMES } from "../lib/kult.mjs";

const ok = req => {
  const key = process.env.BOT_API_KEY || "";
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return key.length >= 16 && got.length === key.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(key));
};
const rows = data => top(data).map((r, i) => ({ rank: i + 1, discordId: r.id, name: r.name, avatar: avatarUrl(r), score: r.score, level: r.level, at: r.at }));

export default async (req) => {
  if (!ok(req)) return json({ error: "unauthorized" }, 401);
  const url = new URL(req.url);
  const store = getStore("leaderboard");
  const week = weekId();

  // /api/bot?rank=<discordId>  →  one player's position this week (for /rank)
  const who = url.searchParams.get("rank");
  if (who) {
    const out = {};
    for (const g of Object.keys(GAMES)) {
      const data = await store.get(boardKey(g, week), { type: "json" });
      const e = data && data.entries[who];
      out[g] = e ? { rank: rankOf(data, who), score: e.score, level: e.level, players: Object.keys(data.entries).length } : null;
    }
    return json({ week, discordId: who, games: out });
  }

  // default: both games' top 10 for this week and last week
  const games = {}, previous = {};
  for (const g of Object.keys(GAMES)) {
    const cur = await store.get(boardKey(g, week), { type: "json" });
    const prev = await store.get(boardKey(g, week - 1), { type: "json" });
    games[g] = { title: GAMES[g], players: cur ? Object.keys(cur.entries).length : 0, top: rows(cur) };
    previous[g] = { title: GAMES[g], players: prev ? Object.keys(prev.entries).length : 0, top: rows(prev) };
  }
  return json({
    week, weekStart: weekStart(week).toISOString(), resetsAt: weekEnd(week).toISOString(),
    play: { catch: "https://ultwithknife.com/lab/#knife-catch", throw: "https://ultwithknife.com/lab/#knife-throw" },
    games, previous
  });
};
export const config = { path: "/api/bot" };
