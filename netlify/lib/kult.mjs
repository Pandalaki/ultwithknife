// Shared helpers for the KULT leaderboard functions.
// Secrets come from Netlify environment variables (never from the repo):
//   DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, BOT_API_KEY (bot feed), DISCORD_WEBHOOK_URL (optional; normally the bot posts)
import crypto from "node:crypto";

export const GAMES = { catch: "Knife Catch", throw: "Knife Throw" };
export const isGame = g => Object.prototype.hasOwnProperty.call(GAMES, g);

/* ---------- weeks: boards reset every Monday 04:00 UTC (midnight New York in summer, 11pm Sunday in winter) ---------- */
const WEEK_MS = 7 * 864e5;
const WEEK0 = Date.UTC(2026, 0, 5, 4); // a Monday, 04:00 UTC
export const weekId = (t = Date.now()) => Math.floor((t - WEEK0) / WEEK_MS);
export const weekStart = w => new Date(WEEK0 + w * WEEK_MS);
export const weekEnd = w => new Date(WEEK0 + (w + 1) * WEEK_MS);

/* ---------- signing (sessions and run tickets) ---------- */
export const secret = () => process.env.DISCORD_CLIENT_SECRET || "";
export function sign(obj, key = secret()) {
  const p = Buffer.from(JSON.stringify(obj)).toString("base64url");
  const s = crypto.createHmac("sha256", key).update(p).digest("base64url");
  return p + "." + s;
}
export function verify(tok, key = secret()) {
  if (!key || typeof tok !== "string") return null;
  const [p, s] = tok.split(".");
  if (!p || !s) return null;
  const e = crypto.createHmac("sha256", key).update(p).digest("base64url");
  if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
  try { return JSON.parse(Buffer.from(p, "base64url").toString()); } catch { return null; }
}
export const randomId = () => crypto.randomBytes(12).toString("base64url");

/* ---------- http helpers ---------- */
export function cookies(req) {
  const out = {};
  for (const part of (req.headers.get("cookie") || "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0) { try { out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1)); } catch {} }
  }
  return out;
}
export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
export const cookie = (name, value, maxAge) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export function sessionUser(req) {
  const u = verify(cookies(req).kult_s);
  return u && u.id && u.exp > Date.now() ? u : null;
}
export const avatarUrl = u =>
  u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`
           : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;

/* ---------- anti-cheat: is this score possible in the time played? ---------- */
export function plausible(game, score, level, ms) {
  const s = ms / 1000;
  if (!Number.isInteger(score) || score < 1 || score > 1e6) return "bad score";
  if (s < 3) return "too fast";
  if (s > 3 * 3600) return "run expired";
  if (game === "catch") {
    // normal play tops out around 15 pts/s; a 5s green candle rush (x2, ~7 items/s) adds up to ~500.
    // This allows a rush every 20s at full combo with room to spare.
    if (score > 50 * s + 100) return "impossible score";
  } else {
    if (!Number.isInteger(level) || level < 1 || level > 999) return "bad level";
    // each level needs at least ~2s (5+ throws plus the clear animation)
    if (s < (level - 1) * 2) return "impossible level";
    // per level: ≤10 knives at up to x3 rapid-fire (+ flame knives x3), ≤2 slices (+3), perfect clear (+5),
    // clear bonus 2×level; after each boss a bonus round (8 knives for 8 coins at +2, +5 for all of them)
    let max = 0; for (let n = 1; n <= level; n++) max += 30 + 18 + 6 + 5 + 2 * n + (n % 5 === 0 ? 25 : 0);
    if (score > max) return "impossible score";
  }
  return null;
}

/* ---------- boards ---------- */
export const boardKey = (game, week) => `board/${game}/${week}`;
export function top(data, n = 10) {
  return Object.entries((data && data.entries) || {})
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, n);
}
// Saves the player's best for the week. Uses etags so two scores at once can't overwrite each other.
export async function recordScore(store, game, week, user, score, level) {
  const key = boardKey(game, week);
  for (let i = 0; i < 6; i++) {
    const cur = await store.getWithMetadata(key, { type: "json" });
    const data = (cur && cur.data) || { entries: {} };
    const before = top(data);
    const prev = data.entries[user.id];
    if (prev && prev.score >= score) return { improved: false, before, after: before, data, mine: prev };
    data.entries[user.id] = { name: user.name, avatar: user.avatar || null, score, level: level ?? null, at: Date.now() };
    const res = await store.setJSON(key, data, cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
    if (res && res.modified === false) continue;
    return { improved: true, before, after: top(data), data, mine: data.entries[user.id] };
  }
  throw new Error("board busy");
}
// all-time board: every player's best ever. Seeded from recent weeks the first time it's read.
export const ALL = "all";
export async function allTime(store, game) {
  const key = boardKey(game, ALL);
  let data = await store.get(key, { type: "json" });
  if (data) return data;
  data = { entries: {} };
  const w = weekId();
  for (const wk of [w - 2, w - 1, w]) {
    const b = await store.get(boardKey(game, wk), { type: "json" });
    for (const [id, e] of Object.entries((b && b.entries) || {})) {
      const cur = data.entries[id];
      if (!cur || e.score > cur.score) data.entries[id] = e;
    }
  }
  await store.setJSON(key, data, { onlyIfNew: true });
  return (await store.get(key, { type: "json" })) || data;
}
export const rankOf = (data, id) => {
  const all = top(data, 1e9);
  const i = all.findIndex(r => r.id === id);
  return i < 0 ? null : i + 1;
};

/* ---------- Discord webhook ---------- */
const MEDALS = ["🥇", "🥈", "🥉"];
const esc = s => String(s).replace(/([\\*_~`|>#\[\]()-])/g, "\\$1").replace(/@/g, "@\u200b").slice(0, 40);
const fmt = n => Number(n).toLocaleString("en-US");
const day = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
export function boardMessage(game, week, rows, final = false) {
  const lines = rows.length
    ? rows.map((r, i) => `${MEDALS[i] || `\`#${i + 1}\``} **${esc(r.name)}** · ${fmt(r.score)}${game === "throw" && r.level ? ` · lvl ${r.level}` : ""}`).join("\n")
    : "_No scores yet. Be the first:_ https://ultwithknife.com/lab/#knife-" + game;
  return {
    username: "Colt",
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `🔪 ${GAMES[game]} · ${final ? "Final results" : "Live leaderboard"}`,
      description: lines,
      color: final ? 0xf2c14e : 0x3fd0ff,
      footer: { text: `Week of ${day(weekStart(week))}${final ? " · final" : ` · resets ${day(weekEnd(week))}`} · ultwithknife.com/lab` },
      url: "https://ultwithknife.com/lab/#knife-" + game
    }]
  };
}
export async function hook(method, path = "", body) {
  const base = process.env.DISCORD_WEBHOOK_URL;
  if (!base) return null;
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 404) return { missing: true };
  if (!r.ok) throw new Error("discord " + r.status + " " + (await r.text()).slice(0, 200));
  return r.status === 204 ? {} : r.json();
}
// keep one live message per game per week; edit it in place, recreate it if someone deleted it
export async function syncBoard(store, game, week, rows, final = false) {
  if (!process.env.DISCORD_WEBHOOK_URL) return;
  const key = `msg/${game}/${week}`;
  const saved = await store.get(key, { type: "json" });
  const body = boardMessage(game, week, rows, final);
  if (saved && saved.id) {
    const r = await hook("PATCH", `/messages/${saved.id}`, body);
    if (!r || !r.missing) return;
  }
  if (final) return;
  const m = await hook("POST", "?wait=true", body);
  if (m && m.id) await store.setJSON(key, { id: m.id });
}
export async function announceTop(game, user, score, level) {
  const what = game === "throw" ? `**level ${level}** (${fmt(score)} pts)` : `**${fmt(score)}** points`;
  await hook("POST", "", {
    username: "Colt",
    content: `👑 <@${user.id}> just took **#1** in ${GAMES[game]} with ${what}! Think you can take it? https://ultwithknife.com/lab/#knife-${game}`,
    allowed_mentions: { users: [user.id] }
  });
}
