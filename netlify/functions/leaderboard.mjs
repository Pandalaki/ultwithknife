// The Lab's "This week's top 10" boards
import { getStore } from "@netlify/blobs";
import { sessionUser, json, weekId, weekEnd, boardKey, top, rankOf, avatarUrl, GAMES } from "../lib/kult.mjs";

export default async (req) => {
  const store = getStore("leaderboard");
  const user = sessionUser(req);
  const week = weekId();
  const games = {};
  for (const g of Object.keys(GAMES)) {
    const data = await store.get(boardKey(g, week), { type: "json" });
    games[g] = {
      top: top(data).map(r => ({ name: r.name, score: r.score, level: r.level, avatar: avatarUrl(r), me: !!user && r.id === user.id })),
      players: data ? Object.keys(data.entries).length : 0,
      me: user && data && data.entries[user.id] ? { rank: rankOf(data, user.id), score: data.entries[user.id].score, level: data.entries[user.id].level } : null
    };
  }
  return json({
    user: user ? { name: user.name, avatar: avatarUrl(user) } : null,
    enabled: !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
    resetsAt: weekEnd(week).toISOString(),
    games
  });
};
export const config = { path: "/api/leaderboard" };
