// Marketplace feed for the NFT gallery: listings, floor and recent sales from Ebisu's Bay.
// The gallery calls this (not Ebisu's Bay directly), so every visitor shares one cached answer
// and we stay well inside their rate limit (250 requests / 5 min per IP without a key).
//
// Netlify env:
//   NFT_COLLECTION   the collection's contract address (0x...). Until it's set, the feed reports "not live".
//   EB_API_KEY       optional Ebisu's Bay partner key (only raises their rate limit).
//   KULT_VERIFY_URL  the KULT verify bot (defaults to the Railway address) for "Kult member" badges.
//
// GET /api/nft-market                     → { live, collection, stats, listings, sales, updatedAt }
// GET /api/nft-market?collection=0x...    → same, for another collection (testing before launch)
const API = "https://api.ebisusbay.com";
const TTL = 60 * 1000; // refresh at most once a minute per warm function
const MAX_LISTING_PAGES = 10; // 1,000 active listings is far more than a 750 collection can have
const ZERO = "0x0000000000000000000000000000000000000000";
const cache = new Map(); // address -> { at, data }
const OWNERS_TTL = 5 * 60 * 1000; // owners change less often; refresh every 5 minutes
const ownersCache = new Map(); // address -> { at, data }
const VERIFY = (process.env.KULT_VERIFY_URL || "https://holder-verify-bot-production-24e2.up.railway.app").replace(/\/$/, "");

const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || "");
const short = (a) => (isAddr(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : null);
const num = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
const sec = (t) => { const n = num(t); return n == null ? null : n > 1e12 ? Math.round(n / 1000) : n; }; // seconds

async function eb(path, params) {
  const url = `${API}${path}?${new URLSearchParams({ chain: "25", ...params })}`;
  const headers = { accept: "application/json" };
  if (process.env.EB_API_KEY) headers["eb-api-key"] = process.env.EB_API_KEY;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
    if (res.status === 429 || res.status === 503) { await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`Ebisu's Bay ${path} answered ${res.status}`);
    return res.json();
  }
  throw new Error(`Ebisu's Bay ${path} is busy`);
}

const tokenUrl = (addr, id) => `https://app.ebisusbay.com/collection/cronos/${addr}/${id}`;
const currencyName = (c) => (!c || c.toLowerCase() === ZERO ? "CRO" : null);

function listingOut(addr, l) {
  return {
    id: Number(l.nftId),
    price: num(l.price),
    currency: currencyName(l.currency) || "token",
    currencyAddress: l.currency || ZERO,
    listingId: l.listingId,
    seller: short(l.seller),
    listedAt: sec(l.listingTime),
    expiresAt: sec(l.expirationDate),
    url: tokenUrl(addr, l.nftId),
  };
}

// Every token's owner (from Ebisu's Bay), plus which owners are verified KULT Discord members.
async function owners(addr) {
  const hit = ownersCache.get(addr);
  if (hit && Date.now() - hit.at < OWNERS_TTL) return hit.data;
  const tokens = {};
  let page = 1, pages = 1;
  do {
    const r = await eb("/fullcollections", { address: addr, pageSize: "100", page: String(page), sortBy: "id", direction: "asc" });
    for (const n of r.nfts || []) if (isAddr(n.owner)) tokens[Number(n.id)] = n.owner.toLowerCase();
    pages = Math.min(r.totalPages || 1, 20);
  } while (++page <= pages);
  let members = {};
  try {
    const wallets = [...new Set(Object.values(tokens))];
    const res = await fetch(`${VERIFY}/api/wallet-members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallets }), signal: AbortSignal.timeout(8000) });
    if (res.ok) members = (await res.json()).members || {};
  } catch (err) { console.error("nft-market members:", err.message); }
  const data = { tokens, members };
  ownersCache.set(addr, { at: Date.now(), data });
  return data;
}

async function build(addr) {
  const [col, firstPage, sold] = await Promise.all([
    eb("/collections", { address: addr }),
    eb("/listings", { collection: addr, state: "0", pageSize: "100", page: "1", sortBy: "price", direction: "asc" }),
    eb("/listings", { collection: addr, state: "1", pageSize: "25", page: "1", sortBy: "saleTime", direction: "desc" }),
  ]);

  let listings = firstPage.listings || [];
  const pages = Math.min(firstPage.totalPages || 1, MAX_LISTING_PAGES);
  for (let p = 2; p <= pages; p++) {
    const more = await eb("/listings", { collection: addr, state: "0", pageSize: "100", page: String(p), sortBy: "price", direction: "asc" });
    listings = listings.concat(more.listings || []);
  }
  // One entry per token: the cheapest valid listing.
  const byToken = {};
  for (const l of listings) {
    if (l.valid === false || l.invalid) continue;
    const out = listingOut(addr, l);
    if (!Number.isFinite(out.id) || out.price == null) continue;
    const cur = byToken[out.id];
    if (!cur || (out.currency === "CRO" && (cur.currency !== "CRO" || out.price < cur.price))) byToken[out.id] = out;
  }

  const c = (col.collections || [])[0] || {};
  const t = (c.stats && c.stats.total) || {};
  const cro = Object.values(byToken).filter((l) => l.currency === "CRO");
  const stats = {
    name: c.name || null,
    floor: num(t.floorPrice) ?? (cro.length ? Math.min(...cro.map((l) => l.price)) : null),
    listed: Object.keys(byToken).length,
    holders: num(c.holders),
    supply: num(c.totalSupply),
    volume: num(t.volume),
    volume7d: num(t.volume7d),
    volume30d: num(t.volume30d),
    sales: num(t.sales),
    currency: "CRO",
  };
  const sales = (sold.listings || []).map((l) => ({
    id: Number(l.nftId),
    price: num(l.price),
    currency: currencyName(l.currency) || "token",
    at: sec(l.saleTime),
    buyer: short(l.purchaser),
    seller: short(l.seller),
    url: tokenUrl(addr, l.nftId),
  })).filter((s) => Number.isFinite(s.id));

  let own = null;
  try { own = await owners(addr); } catch (err) { console.error("nft-market owners:", err.message); own = ownersCache.get(addr)?.data || null; }
  return { live: true, collection: addr, stats, listings: byToken, sales, owners: own, updatedAt: Date.now() };
}

export default async (req) => {
  const url = new URL(req.url);
  const asked = url.searchParams.get("collection");
  const addr = (asked && isAddr(asked) ? asked : process.env.NFT_COLLECTION || "").toLowerCase();
  const headers = { "content-type": "application/json", "cache-control": "public, max-age=30", "netlify-cdn-cache-control": "public, s-maxage=60, stale-while-revalidate=120" };
  if (!isAddr(addr)) return new Response(JSON.stringify({ live: false, reason: "The collection is not live yet." }), { headers });

  const hit = cache.get(addr);
  if (hit && Date.now() - hit.at < TTL) return new Response(JSON.stringify(hit.data), { headers });
  try {
    const data = await build(addr);
    cache.set(addr, { at: Date.now(), data });
    return new Response(JSON.stringify(data), { headers });
  } catch (err) {
    console.error("nft-market:", err.message);
    // Serve the last good answer if we have one, so a hiccup at Ebisu's Bay doesn't blank the gallery.
    if (hit) return new Response(JSON.stringify({ ...hit.data, stale: true }), { headers });
    return new Response(JSON.stringify({ live: false, reason: "Marketplace data is unavailable right now." }), { status: 503, headers: { ...headers, "cache-control": "no-store" } });
  }
};

export const config = { path: "/api/nft-market" };
