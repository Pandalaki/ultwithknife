# ult with knife ($KULT)

Source for https://ultwithknife.com. Netlify publishes the `site/` folder from the `main` branch (plain files, no build step).

## Adding to the Meme Vault

1. Open `site/memes/gifs` (GIFs), `site/memes/images` (meme pictures) or `site/memes/videos` (videos).
2. **Add file → Upload files**, drop your files in, and click **Commit changes**.
3. Wait 2–3 minutes. The "Meme Vault" helper (Actions tab) compresses them, makes the previews and puts them live.

**Name the file how you want it titled**, and add categories in square brackets:

| File name | Shows as |
|---|---|
| `Lambo Cash [bullish].gif` | "Lambo Cash", in Bullish |
| `gm Kult [gm, chill].png` | "gm Kult", in GM / GN and Chill |
| `Never Fold.jpg` | "Never Fold", in All only |

Categories: `bullish`, `reaction`, `flex`, `party`, `chill`, `gm` (GM / GN), `kult`.
Images can be PNG, JPG or WebP. Videos can be MP4, MOV, M4V or WebM (they're converted to phone-friendly 720p MP4 with sound). GitHub's website takes files up to 25 MB; send bigger ones to Claude.

**To rename or recategorize**, edit `site/memes/vault.json` (pencil icon) and commit.
**To remove one**, delete its `.gif` (GIFs), `.jpg` (memes) or `.mp4` (videos) file; the helper cleans up the rest.

## Folders

- `site/` – the website (`index.html`, `lab/` for the KULT Lab, `img/`, `vendor/`, `memes/`)
- `tools/vault.py` + `.github/workflows/vault.yml` – the Meme Vault helper
