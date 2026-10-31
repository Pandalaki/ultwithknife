// Every Monday 04:00 UTC: mark last week's boards final in Discord and start fresh ones
import { getStore } from "@netlify/blobs";
import { weekId, boardKey, top, syncBoard, hook, GAMES } from "../lib/kult.mjs";

export default async () => {
  const store = getStore("leaderboard");
  const now = weekId(), last = now - 1;
  const champs = [];
  for (const g of Object.keys(GAMES)) {
    const rows = top(await store.get(boardKey(g, last), { type: "json" }));
    try {
      await syncBoard(store, g, last, rows, true);
      if (rows[0]) champs.push(`${GAMES[g]}: <@${rows[0].id}> with ${rows[0].score.toLocaleString("en-US")}${g === "throw" && rows[0].level ? ` (level ${rows[0].level})` : ""}`);
      await syncBoard(store, g, now, []);
    } catch (e) { console.error("weekly reset", g, e); }
  }
  try {
    await hook("POST", "", {
      username: "Colt",
      content: champs.length
        ? `🏆 **Week's over.** Champions:\n${champs.join("\n")}\n\nBoards are reset. New week, new knives: https://ultwithknife.com/lab/`
        : "🔪 **New week, new boards.** Play at https://ultwithknife.com/lab/",
      allowed_mentions: { parse: ["users"] }
    });
  } catch (e) { console.error("weekly post", e); }
};
export const config = { schedule: "0 4 * * 1" };
