# Mool

A self-hosted, browser-based screen recorder. v0.1: anonymous recording with shareable links.

## Architecture (v0.1)

- Browser captures the screen (`getDisplayMedia` + `MediaRecorder`) and uploads
  the resulting WebM directly to **Cloudflare R2** via a presigned PUT URL.
- A small **Node/Express** app on this server mints those presigned URLs,
  generates a 6-character base62 slug, and stores `slug → r2_key` in a SQLite
  file under `./data/`.
- Viewers stream playback from R2's public custom domain — the home server is
  not in the playback byte path.
- **Cloudflare Tunnel** exposes the app to the internet. No port forwarding,
  no exposed home IP.

See `docs/superpowers/specs/2026-05-09-v0.1-anonymous-recorder-design.md` for
the full design.

## Prerequisites

- Ubuntu host (or any Linux) with **Docker + Docker Compose** installed.
- A **domain** managed in Cloudflare (the same Cloudflare account you'll use
  for R2 and Tunnel).
- A **Cloudflare R2** subscription (free tier is fine — 10 GB storage, 1M
  Class A ops/month).

## One-time Cloudflare setup

All steps are done in the Cloudflare dashboard.

### 1. Create an R2 bucket

- Go to **R2 → Create bucket**, name it `mool-recordings`.
- After creation: **Settings → Public access → Custom Domains** → add
  `videos.<your-domain>.com`. Cloudflare will create the DNS record for you.
- **Settings → CORS Policy** → add:

  ```json
  [
    {
      "AllowedOrigins": ["https://record.<your-domain>.com"],
      "AllowedMethods": ["PUT"],
      "AllowedHeaders": ["Content-Type"],
      "MaxAgeSeconds": 3600
    }
  ]
  ```

### 2. Create R2 API credentials

- **R2 → Manage R2 API Tokens → Create API Token**.
- Permission: **Object Read & Write**, scoped to the `mool-recordings` bucket.
- Copy the **Access Key ID**, **Secret Access Key**, and **endpoint URL**.
  The endpoint looks like `https://<account-id>.r2.cloudflarestorage.com`.

### 3. Create a Cloudflare Tunnel

- **Zero Trust → Networks → Tunnels → Create a tunnel** (Cloudflared connector).
- Name it (e.g. `mool`). Save the **tunnel token** when shown.
- After creation, in the **Public Hostnames** tab of the tunnel:
  - Subdomain: `record`
  - Domain: `<your-domain>.com`
  - Service type: `HTTP`, URL: `app:3000`
- Save.

## Configure this repo

```bash
cp .env.example .env
# Edit .env and fill in:
#   PUBLIC_APP_URL=https://record.<your-domain>.com
#   R2_ACCESS_KEY_ID=<from step 2>
#   R2_SECRET_ACCESS_KEY=<from step 2>
#   R2_BUCKET=mool-recordings
#   R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
#   R2_PUBLIC_BASE_URL=https://videos.<your-domain>.com
#   TUNNEL_TOKEN=<from step 3>
```

## Run it

```bash
docker compose up -d --build
docker compose logs -f
```

Expected log lines:

- `app` container: `Mool listening on :3000`
- `cloudflared` container: `Registered tunnel connection ...`

Visit `https://record.<your-domain>.com`. You should see the Mool recorder.

## End-to-end smoke test

1. Open `https://record.<your-domain>.com` in Chrome or Firefox.
2. Click **Start Recording** and select a screen / window / tab to share.
3. Wait a few seconds, then click **Stop**.
4. Watch the status update through `Recording…` → `Uploading…` → `Done!`.
5. Click the share link or open it in another browser. The video should play.

If something fails, check `docker compose logs app` for the server side and
your browser's DevTools network tab for the client side.

## Local development

```bash
cd app
npm install
npm test         # run the unit + integration tests
npm run dev      # auto-reloading dev server
```

`.env` lives at the **repo root** and is read by both `dotenv` (for `npm
run dev`) and Docker Compose (`env_file: .env`). It's gitignored.

### Reaching the dev server from your laptop browser

Browsers only expose `getDisplayMedia` (the screen-capture API) in **secure
contexts** — HTTPS or `http://localhost` / `http://127.0.0.1`. Plain HTTP to
a private IP like `http://192.168.x.x:3000` does **not** count, and the API
is silently unavailable.

If the dev server runs on a remote machine, port-forward it to your laptop
over SSH and open `http://localhost:3000` from there:

```bash
ssh -L 3000:localhost:3000 you@your-server
# then in your laptop browser: http://localhost:3000
```

### What works against placeholder R2 credentials

The recorder UI, screen capture, recording loop, and the `POST /create-upload`
server roundtrip work without real R2. The browser-to-R2 PUT will fail
("Upload failed during transfer") because the presigned URL points at a
placeholder endpoint. Replace the `R2_*` values in `.env` with real ones
(see steps 1+2 above) for end-to-end uploads.

R2 CORS is restricted to whatever you put in `AllowedOrigins`. For local
testing you can add `http://localhost:3000` to the list. For full
end-to-end testing, run the recorder via the Cloudflare Tunnel hostname.

## Project layout

```
mool/
├── app/                   # The Node/Express app (see app/src/)
├── docker-compose.yml     # app + cloudflared
├── data/                  # SQLite database (gitignored, created at runtime)
└── docs/superpowers/      # Specs and plans
```

## What's not in v0.1

No accounts, no microphone, no webcam, no editing, no comments, no file expiry.
See the spec's growth ladder for what comes next.
