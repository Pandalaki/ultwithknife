"""Meme Vault helper.

Runs on GitHub after every upload (see .github/workflows/vault.yml), and can be run by hand:
    python3 tools/vault.py

What it does
  1. Finds new uploads in site/memes/gifs/ and site/memes/images/ (any file that isn't already in the vault),
     names them from the file name, compresses them and makes the grid previews:
       "Lambo Cash [bullish].gif"   -> title "Lambo Cash", category Bullish
       "gm Kult [gmgn, chill].png"  -> title "gm Kult", categories GM / GN + Chill
  2. Drops vault entries whose file was deleted (and cleans up their previews).
  3. Writes site/memes/vault.json and rebuilds the vault data inside site/lab/index.html and the count on the homepage.

Titles and categories can be edited any time in site/memes/vault.json.
"""
import json, os, re, shutil, subprocess, sys, unicodedata
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SITE = os.path.join(ROOT, "site")
GIFS = os.path.join(SITE, "memes", "gifs")
IMGS = os.path.join(SITE, "memes", "images")
VIDS = os.path.join(SITE, "memes", "videos")
FOLDER = {"gif": GIFS, "img": IMGS, "vid": VIDS}
MAIN_EXT = {"gif": "gif", "img": "jpg", "vid": "mp4"}
VAULT = os.path.join(SITE, "memes", "vault.json")
LAB = os.path.join(SITE, "lab", "index.html")
HOME = os.path.join(SITE, "index.html")

TAG_ALIASES = {"bullish": "bullish", "bull": "bullish", "reaction": "reaction", "reactions": "reaction",
               "flex": "flex", "party": "party", "chill": "chill", "gmgn": "gmgn", "gm": "gmgn", "gn": "gmgn",
               "gm/gn": "gmgn", "kult": "kult"}
GIF_MAX = 10_000_000  # keep each download under ~10 MB
GIFSICLE = os.environ.get("GIFSICLE", "gifsicle")
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE", "ffprobe")


def log(*a):
    print("[vault]", *a, flush=True)


def slugify(t):
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode()
    t = re.sub(r"[^a-zA-Z0-9]+", "-", t).strip("-").lower()
    return t or "meme"


def parse_name(filename):
    stem = os.path.splitext(filename)[0]
    tags = []
    for group in re.findall(r"\[([^\]]*)\]", stem):
        for t in re.split(r"[,\s]+", group.strip().lower()):
            if t in TAG_ALIASES and TAG_ALIASES[t] not in tags:
                tags.append(TAG_ALIASES[t])
    title = re.sub(r"\[[^\]]*\]", "", stem).strip()
    if title.lower().startswith("kult-"):
        title = title[5:]
    if " " not in title and re.search(r"[-_]", title):
        title = re.sub(r"[-_]+", " ", title).strip().title()
    title = re.sub(r"\s+", " ", title) or "Untitled"
    return title, tags


def unique_id(base, taken):
    i, cand = 2, base
    while cand in taken:
        cand = f"{base}-{i}"; i += 1
    return cand


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def process_gif(src, vid):
    out = os.path.join(GIFS, f"kult-{vid}.gif")
    tmp = out + ".tmp.gif"
    run([GIFSICLE, "-O3", "--lossy=35", "--no-warnings", src, "-o", tmp])
    if os.path.getsize(tmp) > GIF_MAX:
        run([GIFSICLE, "-O3", "--lossy=80", "--colors", "200", "--no-warnings", src, "-o", tmp])
    if os.path.getsize(tmp) > GIF_MAX:
        run([GIFSICLE, "-O3", "--lossy=80", "--colors", "200", "--resize-fit", "640x640", "--no-warnings", src, "-o", tmp])
    if os.path.getsize(tmp) > os.path.getsize(src) and os.path.getsize(src) <= GIF_MAX:
        shutil.copyfile(src, tmp)  # never make it bigger
    run([FFMPEG, "-v", "error", "-y", "-i", tmp, "-movflags", "+faststart", "-pix_fmt", "yuv420p",
         "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-crf", "24", "-preset", "slow", "-an",
         os.path.join(GIFS, f"kult-{vid}.mp4")])
    with Image.open(tmp) as im:
        im.seek(0); im.convert("RGB").save(os.path.join(GIFS, f"kult-{vid}.webp"), quality=72)
    if os.path.abspath(src) != os.path.abspath(out):
        os.remove(src)
    os.replace(tmp, out)


def process_image(src, vid):
    with Image.open(src) as im0:
        im = im0.convert("RGB")
    if max(im.size) > 1600:
        im.thumbnail((1600, 1600), Image.LANCZOS)
    full = os.path.join(IMGS, f"kult-{vid}.jpg")
    tmp = full + ".tmp.jpg"
    im.save(tmp, quality=90, optimize=True, progressive=True)
    p = im.copy(); p.thumbnail((640, 640), Image.LANCZOS)
    p.save(os.path.join(IMGS, f"kult-{vid}.webp"), quality=76)
    if os.path.abspath(src) not in (os.path.abspath(full), os.path.join(IMGS, f"kult-{vid}.webp")):
        os.remove(src)
    os.replace(tmp, full)


def process_video(src, vid):
    out = os.path.join(VIDS, f"kult-{vid}.mp4")
    tmp = out + ".tmp.mp4"
    # phone-friendly: H.264 + AAC, longest side at most 1280 px, starts playing before it's fully downloaded
    run([FFMPEG, "-v", "error", "-y", "-i", src, "-map", "0:v:0", "-map", "0:a:0?",
         "-vf", "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',scale=trunc(iw/2)*2:trunc(ih/2)*2",
         "-c:v", "libx264", "-crf", "26", "-preset", "slow", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
         "-movflags", "+faststart", tmp])
    if os.path.getsize(tmp) > os.path.getsize(src) and src.lower().endswith(".mp4"):
        shutil.copyfile(src, tmp)  # already small: keep the original
    poster = os.path.join(VIDS, f"kult-{vid}.webp")
    try:
        run([FFMPEG, "-v", "error", "-y", "-ss", "1", "-i", tmp, "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", poster])
    except subprocess.CalledProcessError:
        run([FFMPEG, "-v", "error", "-y", "-i", tmp, "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", poster])
    if not os.path.exists(poster):  # very short clip: grab the first frame
        run([FFMPEG, "-v", "error", "-y", "-i", tmp, "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", poster])
    if os.path.abspath(src) != os.path.abspath(out):
        os.remove(src)
    os.replace(tmp, out)


def duration(path):
    try:
        out = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                             check=True, capture_output=True, text=True).stdout.strip()
        return round(float(out), 1)
    except Exception:
        return 0


def main():
    vault = json.load(open(VAULT)) if os.path.exists(VAULT) else []
    known = {(e["kind"], e["id"]) for e in vault}
    taken = {e["id"] for e in vault}
    changed = False

    # 1. new uploads
    os.makedirs(VIDS, exist_ok=True)
    for folder, kind, exts in [(GIFS, "gif", (".gif",)), (IMGS, "img", (".png", ".jpg", ".jpeg", ".webp")),
                               (VIDS, "vid", (".mp4", ".mov", ".m4v", ".webm"))]:
        for name in sorted(os.listdir(folder)):
            path = os.path.join(folder, name)
            if not os.path.isfile(path) or name.startswith("."):
                continue
            if ".tmp." in name or name == ".gitkeep":
                continue
            m = re.fullmatch(r"kult-(.+)\.(gif|mp4|webp|jpg)", name)
            if m and (kind, m.group(1)) in known:
                continue  # already in the vault (or one of its previews)
            ext = os.path.splitext(name)[1].lower()
            if ext not in exts:
                if ext in (".mp4", ".webp", ".jpg") and m:
                    continue  # leftover preview; cleaned up below
                log("skipping unsupported file", name)
                continue
            title, tags = parse_name(name)
            vid = unique_id(slugify(title), taken)
            log(f"adding {name} -> '{title}' ({kind}) {tags}")
            try:
                {"gif": process_gif, "img": process_image, "vid": process_video}[kind](path, vid)
            except Exception as e:  # a broken file shouldn't stop the rest
                log("could not process", name, "-", e)
                continue
            vault.append({"id": vid, "title": title, "tags": tags, "kind": kind})
            known.add((kind, vid)); taken.add(vid); changed = True

    # 2. deleted files
    keep = []
    for e in vault:
        folder = FOLDER[e["kind"]]
        main_file = os.path.join(folder, f"kult-{e['id']}.{MAIN_EXT[e['kind']]}")
        if os.path.exists(main_file):
            keep.append(e); continue
        log("removing", e["title"])
        for ext in ("gif", "mp4", "webp", "jpg"):
            f = os.path.join(folder, f"kult-{e['id']}.{ext}")
            if os.path.exists(f):
                os.remove(f)
        changed = True
    vault = keep

    # 3. publish the list
    items = []
    for e in vault:
        folder = FOLDER[e["kind"]]
        main_file = os.path.join(folder, f"kult-{e['id']}.{MAIN_EXT[e['kind']]}")
        with Image.open(os.path.join(folder, f"kult-{e['id']}.webp")) as im:
            w, h = im.size
        it = {"id": e["id"], "t": e["title"], "tags": e.get("tags", []), "k": e["kind"], "w": w, "h": h,
              "kb": round(os.path.getsize(main_file) / 1024)}
        if e["kind"] == "img":
            it["ext"] = "jpg"
        if e["kind"] == "vid":
            it["ext"] = "mp4"
            if not e.get("dur"):
                e["dur"] = duration(main_file)
            it["dur"] = e["dur"]
        items.append(it)

    with open(VAULT, "w") as f:
        json.dump(vault, f, indent=1, ensure_ascii=False); f.write("\n")
    data = json.dumps(items, ensure_ascii=False, separators=(",", ":"))
    s = open(LAB).read()
    s2, n = re.subn(r"/\*MEMES\*/.*?/\*END\*/", lambda m: "/*MEMES*/" + data + "/*END*/", s, flags=re.S)
    if n != 1:
        sys.exit("vault data marker not found in lab/index.html")
    if s2 != s:
        open(LAB, "w").write(s2)
    nG = sum(1 for i in items if i["k"] == "gif"); nI = sum(1 for i in items if i["k"] == "img"); nV = len(items) - nG - nI
    h = open(HOME).read()
    pl = lambda n, w: f"{n} {w}" + ("" if n == 1 else "s")
    label = pl(nG, "Colt GIF") + (f", {pl(nI, 'meme')} and {pl(nV, 'video')}" if nV else f" and {pl(nI, 'meme')}" if nI else "")
    h2 = re.sub(r"\d+ Colt GIFs?(?:,? (?:and )?\d+ memes?)?(?: and \d+ videos?)?, free to download", label + ", free to download", h)
    if h2 != h:
        open(HOME, "w").write(h2)
    log(f"{nG} GIFs, {nI} memes, {nV} videos" + (" (updated)" if changed else ""))


if __name__ == "__main__":
    main()
