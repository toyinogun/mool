# Mool

A self-hosted, browser-based screen recorder. Captures the screen in the browser, uploads to Cloudflare R2, and serves a share link backed by R2's public custom domain.

## Language

**Recording**:
A captured screen video, identified by a unique slug. Has two physical manifestations — a row in SQLite (metadata) and an object in R2 (bytes) — but is one conceptual thing.
_Avoid_: video, clip, capture, asset

**Slug**:
The 6-character base62 identifier (`[A-Za-z0-9]{6}`) that names a Recording in URLs. Generated server-side, unique by construction.
_Avoid_: id, code, token, hash

**R2 key**:
The object key under which a Recording's bytes live in the R2 bucket. Currently `<slug>.webm`; format is owned by the Recording module.
_Avoid_: filename, path, blob name

**Upload URL**:
A short-lived presigned PUT URL the browser uses to upload bytes directly to R2, bypassing the home server.
_Avoid_: signed URL, put URL, upload link

**Viewer URL**:
The share link of the form `record.<domain>/v/<slug>` that opens the Viewer page.
_Avoid_: share link, watch URL, public URL

**Recorder page**:
The page served at `/` where a user starts a new Recording.
_Avoid_: home page, capture page

**Viewer page**:
The page served at `/v/:slug` that plays back a Recording. Streams bytes directly from R2's public custom domain — the home server is not in the playback byte path.
_Avoid_: watch page, playback page

## Relationships

- A **Recording** is identified by exactly one **Slug**
- A **Recording**'s bytes live at exactly one **R2 key**
- The **Recorder page** produces an **Upload URL** and a **Viewer URL** when a Recording is created
- The **Viewer page** resolves a **Slug** to the public R2 location of the bytes

## Example dialogue

> **Dev:** "When the browser hits Stop, who picks the **Slug**?"
> **Domain expert:** "The server. The Recording module generates the **Slug**, writes the row, mints the **Upload URL** against the **R2 key**, and hands back both the Upload URL and the **Viewer URL**. The browser never invents identifiers."

## Flagged ambiguities

- "Recording" was loosely used to mean either the SQLite row or the R2 object. Resolved: a **Recording** is the conceptual entity; the row and the object are its two manifestations, and the Recording module owns the mapping between them.
