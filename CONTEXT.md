# Mool

A self-hosted, browser-based screen recorder. Captures the screen in the browser, uploads to Cloudflare R2, and serves a share link backed by R2's public custom domain.

## Language

**User**:
An authenticated principal, identified by an email address. Owns Recordings. Identified in the data layer by a UUID (`users.id`). Display name is auto-derived from the email local-part on first sign-in (e.g. `alice` from `alice@example.com`) and is not currently editable.
_Avoid_: account, member, owner

**Session**:
An authenticated browser-side handle on a User. Identified by a random 32-byte token (the secret); stored as its SHA-256 hash in the `sessions` table. Carried in the `mool_session` cookie (`HttpOnly`, `SameSite=Lax`). Expires after 30 days.
_Avoid_: auth token, login

**Signin token**:
A one-time token — 32 random bytes, base64url-encoded — valid for 15 minutes. Sent inside the magic-link email as a query parameter; consumed on the user's first click, which creates a Session. Only the most recently issued token for a given email is valid (earlier ones are invalidated on issue).
_Avoid_: magic link (that is the email URL containing the token), login link

**Recording**:
A captured screen video, identified by a unique slug. Owned by exactly one User. Has two physical manifestations — a row in Postgres (metadata, including `user_id`) and an object in R2 (bytes) — but is one conceptual thing. A Recording exists once both manifestations are persisted; the in-browser state before that is a **Capture**.
_Avoid_: video, clip, asset

**Capture**:
The in-browser, pre-upload state of a recording-in-progress: the active `MediaStream`(s), the `MediaRecorder`, and the accumulated chunks. A Capture becomes a Recording when its bytes are uploaded and its row is written. Owned by the Recorder page's `recorderCapture` module; the Recording module never sees one.
_Avoid_: stream, session, draft

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

**Playback URL**:
The public URL where R2 serves a Recording's bytes (`<publicBaseUrl>/<R2 key>`). The Viewer page embeds this in `<video src=...>`. The home server is not in this byte path.
_Avoid_: video URL, source URL, bytes URL, public R2 URL

**Recorder page**:
The page served at `/` where a user starts a new Recording.
_Avoid_: home page, capture page

**Viewer page**:
The page served at `/v/:slug` that plays back a Recording. Streams bytes directly from R2's public custom domain — the home server is not in the playback byte path.
_Avoid_: watch page, playback page

## Relationships

- A **Recording** is identified by exactly one **Slug**
- A **Recording** is owned by exactly one **User**
- A **Recording**'s bytes live at exactly one **R2 key**
- A **User** may have many **Sessions**; each **Session** identifies exactly one **User**
- A **Signin token** is issued to an email address and becomes a **Session** on first use
- The **Recorder page** produces an **Upload URL** and a **Viewer URL** when a Recording is created
- The **Viewer page** resolves a **Slug** to its **Playback URL** (a signed-GET URL, short-lived)

## Example dialogue

> **Dev:** "When the browser hits Stop, who picks the **Slug**?"
> **Domain expert:** "The server. The Recording module generates the **Slug**, writes the row, mints the **Upload URL** against the **R2 key**, and hands back both the Upload URL and the **Viewer URL**. The browser never invents identifiers."

## Flagged ambiguities

- "Recording" was loosely used to mean either the SQLite row or the R2 object. Resolved: a **Recording** is the conceptual entity; the row and the object are its two manifestations, and the Recording module owns the mapping between them.

## Known code duplication

- **`formatElapsed`** appears in two places: `app/src/public/recorder.js` (drives the in-page timer) and `app/src/public/recorderFloatingCam.js` (drives the PiP timer). Both are four lines, identical, formatting milliseconds into `MM:SS`. The duplication is deliberate per [`docs/superpowers/specs/2026-05-11-pip-timer-and-red-stop-design.md`](docs/superpowers/specs/2026-05-11-pip-timer-and-red-stop-design.md) §4: pulling it across the module boundary would require either exporting a recorder-page helper or moving it to a shared module — both larger refactors than four trivial lines justify. If a third caller appears, extract then. Drift risk: if one copy changes (e.g., adds hour rollover for long recordings), the other must too.
