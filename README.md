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

Music Shelf serves metadata only: it does not play, serve or download audio.
An external publisher supplies full library snapshots through a signed API.
The Node server stores the current catalog and history in SQLite.

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
| `SHELF_PUBLISHER_PUBLIC_KEY_FILE` | PEM Ed25519 public key enabling signed imports. Without it, publishing is disabled. |
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
can expose it. To enable imports, mount the publisher's public key read-only
and configure its container path. Keep the private signing key exclusively in
the external publisher. The runtime has also been validated in an isolated Docker deployment.

## API and history

History supports multi-select event filters and a calendar date interval. Filters
are persisted from Redux to local storage. History filtering runs on the server
before keyset pagination, so totals and every subsequent page use the same
criteria. Changing filters restarts loading at the newest matching event. The
calendar includes both selected days in the browser timezone, including daylight
saving changes.

See [the API contract](docs/api.md) and [synthetic example](examples/snapshot.json).
Full snapshots replace the current catalog atomically and preserve history.
Stable track IDs identify transitions. Exact retries are idempotent and stale
snapshots are rejected.

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

Download-service APIs and the actual file/queue synchronization collector stay
private. Deployment-specific proxy, DNS and network settings stay private too.
Those services can publish the documented metadata without becoming part of
this application's source code.

## AI assistant and song texts

Signed-in users can save lyrics and translations for each song in language tabs. English, Spanish and Russian are offered by default; users can add another two- or three-letter language code and mark the original. Previously saved translations without language information are shown under `und` until the user identifies them. These texts are
private to the verified email account and survive catalog synchronization.
Open the AI assistant from the menu, then open its settings to save an OpenRouter
API token and select a model. The token is encrypted on the server using a key
derived from the existing authentication secret, and is never returned by the
API. Keep the authentication secret with database backups; changing it makes
previously stored OpenRouter tokens unreadable. Users can replace or remove a
saved token. Model calls send the conversation to OpenRouter and can incur costs
according to the selected model's pricing. Chat messages are stored on the server separately for each verified email account
and restored when signing in from another browser. The assistant receives recent
conversation turns as context. Earlier browser-only messages cannot be recovered. The assistant does not yet queue downloads.

## Music assistant tools

For tool-capable OpenRouter models, the assistant can query the library and
history, search the local SpotiFLAC API, inspect its live queue, and edit the
signed-in user's song texts by language. Queue additions are restricted to email
addresses configured by `SHELF_QUEUE_USERS_FILE` (a private comma-separated file) or `SHELF_QUEUE_USERS`. An empty configuration denies queue additions. A Corgi-side worker initiates a
signed connection to Music Shelf and performs only three allowed operations
against the existing loopback SpotiFLAC API. The worker does not accept shell
commands, output paths or arbitrary URLs. Models receive only the required tool
results, and cannot directly access servers or credentials. The assistant instructions call for explicit requests before queue additions
or lyric changes. Queue permissions are additionally enforced by the server.
Model-generated statements should be verified against tool results.
