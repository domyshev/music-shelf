# Music Shelf

A compact, self-hosted metadata catalog for a personal music library. A new
implementation using React, TypeScript, Material UI, Redux Toolkit, TanStack
Table and TanStack Virtual. The interface uses English labels.

The viewport contains a compact wordmark, search, counters and an independently
scrolling table. The browser initially requests 25 songs per page. Columns show status, song, artist, year, sample rate, bit depth
and file size. Song titles open file details, including the checksum. Columns can be resized and reordered with their hover handles; these preferences and the column filters
are persisted from Redux to local storage. Status, artist and year support sorted multi-select filters
processed on the server before pagination. Light, system and dark themes are available in the menu.
A separate
history popover shows durable events newest first. Logout lives in the header
menu. Both tables virtualize rows.

Artist names in the songs table open a name card when clicked. In song details,
artist and album names show arrowed card previews on hover or keyboard focus;
clicking opens a persistent card. Names underline on hover without changing
their color. Cards currently display the supplied name only.

Music Shelf manages a music catalog and file imports. The Node server stores the catalog, account data and upload history in SQLite. Audio lives in a configurable music directory, which may be on another server. A storage worker initiates outbound signed HTTPS requests, verifies imported audio and confirms storage. Navidrome remains an independent music player pointed at that directory.

## Local development

Use Node.js 24 or newer and npm. SQLite uses the built-in `node:sqlite` module.

```sh
npm ci
cp .env.example .env
# Edit .env and configure your Resend API key and verified sender.
npm run dev
```

Vite prints the development URL and proxies API requests to the local server.
The catalog starts empty. For an isolated fictional library:

```sh
npm run demo
SHELF_DB_PATH=local/demo.sqlite SHELF_DEMO_MODE=1 npm run dev
```

The demo creates 3,000 synthetic records with fabricated file properties and
checksums; no audio exists. It refuses to overwrite an existing database.
`SHELF_DEMO_COUNT` (up to 10,000) and `SHELF_DEMO_DB` customize generation.
Keep the demonstration database separate from a real catalog.

## Build and run

```sh
npm run build
npm start
```

The server defaults to `http://127.0.0.1:4174` and `data/library.sqlite`.
Configuration comes from the environment and an optional `.env` file; existing
environment variables take precedence.

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Private Resend API key, required for production delivery. |
| `EMAIL_FROM` | Verified sender address, required in production. |
| `SHELF_ORIGIN` | Exact browser origin for authentication requests. Use the Vite origin in development and HTTPS in production. |
| `SHELF_AUTH_SECRET_FILE` | Optional private file containing 64 random hexadecimal characters for code hashing. Defaults to a generated `auth.secret` beside SQLite. |
| `SHELF_DB_PATH` | Persistent SQLite database path. |
| `SHELF_STORAGE_PUBLIC_KEY_FILE` | PEM Ed25519 public key authenticating the outbound storage worker. |
| `SHELF_DEMO_MODE` | Set to `1` for synthetic catalogs to show a visible demo label. Never enable for the real library. |
| `HOST`, `PORT` | Bind address and port. Defaults: `127.0.0.1`, `4174`. |

Sign-in uses a six-digit email code, valid for 10 minutes with at most five
verification attempts. Request limits prevent repeated delivery to the same
address and bound overall email use. Codes are stored only as keyed hashes.
After verification, a random session is kept for 30 days in an HttpOnly,
SameSite=Lax cookie (Secure on HTTPS). Only session hashes are stored in SQLite;
neither codes nor session tokens enter Redux or local storage. Logout revokes the
session. Shared access codes are no longer accepted. Anyone who can verify their
email can access this shared catalog; this is not an email allowlist.

Set `SHELF_ORIGIN=http://127.0.0.1:4174` when serving a local production build,
or to your public HTTPS origin when deployed. Without a configured email
provider, local code requests fail closed. Never log codes for development.

Stop the server before copying SQLite for a simple consistent backup, or use a
SQLite-aware backup tool.

## Container

```sh
# Set the origin and private email-provider configuration in .env first.
docker compose up --build -d
```

The portable example binds `127.0.0.1:8080`, runs as an unprivileged user and
persists SQLite in `shelf-data`. A separately configured HTTPS reverse proxy
can expose it. To enable storage, mount the storage worker's public key read-only and configure its container path. Keep the private signing key exclusively on the music server. The runtime has also been validated in an isolated Docker deployment.

## API and history

History supports multi-select event filters and a calendar date interval. Filters
are persisted from Redux to local storage. History filtering runs on the server
before keyset pagination, so totals and every subsequent page use the same
criteria. Changing filters restarts loading at the newest matching event. The
calendar includes both selected days in the browser timezone, including daylight
saving changes.

See [the API contract](docs/api.md) and [synthetic example](examples/snapshot.json).
Verified storage registrations add files without replacing the existing catalog.
Stable track IDs preserve links to account data. The legacy full-snapshot
contract is retained for explicit migration tooling and is disabled by the
normal server entry point.

Actual source completion timestamps are retained when available. Existing files
first seen without a completion time produce an import event, rather than an
invented download date. Newly ready files without source dates use observation
time. The history date tooltip explains the timestamp source. Repeated updates
of the same file do not create repeated download events.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

Node tests cover signed imports, email-code/session authentication, origin validation, delivery throttling, validation, idempotence,
snapshot ordering, durable events, timestamp handling and pagination.
Optional browser regression specifications use synthetic API responses:

```sh
npx playwright install chromium
npm run test:ui
```

At initial implementation, type checking, production build and all eleven Node
tests passed. The production preview was manually checked with 3,000 synthetic
records at desktop and phone widths. The automated Playwright specifications
have not yet been executed.

## Public repository boundary

This repository contains application code, a generic catalog/history API,
models, tests, synthetic fixtures and portable build instructions. It contains
no real library, audio, access codes, credentials, private keys or home
infrastructure configuration. Runtime databases, local configuration and audio
are ignored by Git and excluded from the container build context.

Deployment-specific storage paths and private runtime data stay private. Deployment-specific proxy, DNS and network settings stay private too.
Those services can publish the documented metadata without becoming part of
this application's source code.

## AI assistant and song texts

Signed-in users can save lyrics and translations for each song in language tabs.
English, Spanish and Russian are offered by default; users can add another two- or
three-letter code and choose the original in language settings. Multiple languages
can be selected and read side by side in one scrolling area. Previously saved
translations without language information are shown under `und`. Texts are
private to the verified email account and survive catalog synchronization.
Open the AI assistant from the header, then open Agent settings to save an OpenRouter
API token and select a model. The token is encrypted on the server using a key
derived from the existing authentication secret, and is never returned by the
API. Keep the authentication secret with database backups; changing it makes
previously stored OpenRouter tokens unreadable. Users can replace or remove a
saved token. Model calls send the conversation to OpenRouter and can incur costs
according to the selected model's pricing. Chat messages are stored on the server separately for each verified email account
and restored when signing in from another browser. The assistant receives recent
conversation turns as context. Earlier browser-only messages cannot be recovered.

The assistant and song card can be docked left or right or opened as a dialog. On
desktop, drag the inner edge to resize either drawer; dialogs can also be resized
vertically. Position and size preferences are stored locally in the browser. Enter sends a message and Shift+Enter inserts a line break.
Assistant replies support Markdown, including lists and tables.

## Music assistant tools

For tool-capable OpenRouter models, the assistant can query the catalog and
history, inspect uploads, organize existing catalog tracks into selection tags,
and edit the signed-in user's song texts. It cannot search external download
providers, submit acquisition jobs or manage a downloader queue. Historical
catalog records and events are retained. Pending legacy records are catalog
metadata, not active download jobs.

## Music imports and storage

Open **Upload music** using the plus above the library or in the assistant input.
The same dialog accepts drag and drop or file selection and shows upload history,
archive contents, SHA-256 checksums, per-file results and downloadable JSON reports.
Upload audio files together, or exactly one ZIP archive; do not mix the two.
Requests are limited to 80 MiB; ZIP contents are limited to 1 GiB, 200 entries
and 512 MiB per file. Unsafe paths, links, encrypted archives and checksum errors
are rejected. Non-audio archive entries are reported as unsupported.

Configure `SHELF_UPLOAD_USERS_FILE` (a private comma-separated account list) or
`SHELF_UPLOAD_USERS` to permit imports. An empty list denies imports. Owners can
create and revoke upload API keys in Settings. The server displays each random
key once and stores only its SHA-256 digest. Keys permit uploads and report reads
for their account; they cannot manage keys, edit lyrics or access storage-worker
operations. See [the import API](docs/api.md#music-upload-api).

`SHELF_UPLOAD_STAGING` defaults to `upload-staging` beside the database. Keep it
on a persistent local disk. The server requires 1.5 GiB free before receiving an
upload, serializes incoming requests and removes temporary bytes after confirmed
delivery. Incomplete directories are recovered after restart. The initial report
can say `staged`: the remote music server has not yet confirmed storage. Final
reports say `complete`, `partial` or `failed`; individual files say `ready` or
`failed`. Do not treat HTTP 202 as confirmed publication in Navidrome.

Run [the storage worker](storage/worker.py) on the music server using Python 3,
OpenSSL, FFmpeg and FFprobe. It can also run alongside the backend with a local
mounted directory. Set:

- `SHELF_SITE`: exact Music Shelf origin.
- `SHELF_MUSIC_ROOT`: dedicated music directory.
- `SHELF_STORAGE_STATE`: persistent worker manifest directory.
- `SHELF_STORAGE_PRIVATE_KEY_FILE`: private Ed25519 key, kept on the music server.
- `SHELF_FFMPEG`, `SHELF_FFPROBE`: executable paths if absent from PATH.

Generate a storage-only key on that server with `openssl genpkey -algorithm
ED25519 -out storage.key` and derive its public key with `openssl pkey -in
storage.key -pubout -out storage.pub`. Provision only `storage.pub` to the backend
and configure `SHELF_STORAGE_PUBLIC_KEY_FILE`. Protect the private key and state
with owner-only permissions. The worker uses timestamped, path-bound signatures
and unique nonces; the server persists replay protection. No incoming connection
to the music server, remote shell command, destination path or arbitrary URL is
accepted from the backend. Keep existing DMZ-to-LAN restrictions in place.

The worker checks file size, SHA-256, audio metadata and full decoding before
confirming delivery. Acquisitions from third-party music services are not part of
this application. A systemd example is in
[storage/music-shelf-storage.service](storage/music-shelf-storage.service); adapt
its account and paths for your installation. The example runs under a dedicated account, hides home directories and limits
its writable paths. Adapt its directory ownership and environment configuration
to your deployment.

The worker scans existing audio without deleting catalog entries. Matching
checksums reuse existing track IDs so lyrics and selection tags retain their
links. New files receive content-based IDs. Original audio and account data must
be backed up independently. Storage confirmations are idempotent, allowing a
worker to retry safely after interruption. Navidrome scans the verified music
folder independently; confirmed storage is distinct from its next library scan.


For a portable Docker deployment with local storage, generate the key pair in
`local/storage-auth`, configure the public key path inside the app as
`/run/storage-auth/storage.pub`, and set `SHELF_MUSIC_PATH` to the host music
folder. `docker compose --profile storage up --build -d` starts the optional
worker beside the app. Give the worker's configured UID write permission to
that folder. For remote storage, run only the app on the web server and deploy
the worker separately with its private key; provision only the public key on
the web server. Never mount the private storage key into the web app.
