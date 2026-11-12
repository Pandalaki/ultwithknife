// Share page for one Colt: https://ultwithknife.com/nft/406
// X, Discord, Telegram and iMessage read the tags below and show a preview card with the art, rank and tier.
// People who open the link are sent straight on to that Colt in the gallery.
//
// Stays switched off until reveal (the art must not be public before then):
//   NFT_SHARE_LIVE=1    turn it on. Until then /nft/... just goes to the home page.
//   NFT_GALLERY_PATH    where the public gallery lives (default /nfts/).
// Files it expects on the site at reveal (made by the gallery tools, not stored in git before then):
//   /nfts/share.json          { n, items: { "406": [rank, tier, "rarest trait (x of n)"] } }
//   /nfts/cards/406.jpg       1200x630 preview card for each Colt
const TTL = 10 * 60 * 1000;
let cache = { at: 0, data: null };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 });

async function shareData(origin) {
  if (cache.data && Date.now() - cache.at < TTL) return cache.data;
  try {
    const r = await fetch(`${origin}/nfts/share.json`);
    if (r.ok) cache = { at: Date.now(), data: await r.json() };
  } catch (e) { /* keep the last good copy */ }
  return cache.data;
}

async function priceOf(origin, id) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(`${origin}/api/nft-market`, { signal: ctl.signal }); clearTimeout(t);
    const d = await r.json(); const l = d && d.live && d.listings && d.listings[id];
    return l ? `${fmt(l.price)} ${l.currency || "CRO"}` : null;
  } catch (e) { return null; }
}

export default async (req) => {
  const url = new URL(req.url), origin = url.origin;
  const gallery = process.env.NFT_GALLERY_PATH || "/nfts/";
  if (process.env.NFT_SHARE_LIVE !== "1") return Response.redirect(`${origin}/`, 302);

  const id = (url.pathname.match(/\/nft\/(\d{1,5})\/?$/) || [])[1];
  const data = id && (await shareData(origin));
  const row = data && data.items && data.items[id];
  if (!row) return Response.redirect(`${origin}${gallery}`, 302);

  const [rank, tier, rarest] = row, n = data.n;
  const price = await priceOf(origin, id);
  const page = `${origin}/nft/${id}`, target = `${gallery}#nft-${id}`, img = `${origin}/nfts/cards/${id}.jpg`;
  const title = `KULT #${id} · Rank ${rank} of ${n} · ${tier}`;
  const desc = [`A ${tier} Colt from The Kult, rarity rank ${rank} of ${n}.`, rarest && `Rarest trait: ${rarest}.`, price && `For sale on Ebisu's Bay: ${price}.`].filter(Boolean).join(" ");

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(page)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ult with knife">
<meta property="og:url" content="${esc(page)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(`KULT #${id}, ${tier}, rank ${rank} of ${n}`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(img)}">
<meta name="theme-color" content="#05080c">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
<link rel="icon" href="/favicon-32.png">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#05080c;color:#e8f1f8;font:16px system-ui,sans-serif;text-align:center}img{max-width:min(92vw,600px);height:auto;display:block;margin:0 auto 16px}a{color:#3fd0ff}</style>
</head><body>
<main><img src="${esc(img)}" alt="${esc(title)}" width="1200" height="630"><p><a href="${esc(target)}">See KULT #${esc(id)} in the gallery</a></p></main>
<script>location.replace(${JSON.stringify(target)});</script>
</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
};

export const config = { path: "/nft/*" };
