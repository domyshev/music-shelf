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

Music Shelf serves metadata only: it does not play, serve or download audio.
An external publisher supplies full library snapshots through a signed API.
The Node server stores the current catalog and history in SQLite.

## Local development

Use Node.js 24 or newer and npm. SQLite uses the built-in `node:sqlite` module.

```sh
npm ci
cp .env.example .env
# Edit .env and choose your own SHELF_ACCESS_CODE.
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
| `SHELF_ACCESS_CODE` | Owner-selected shared code; required unless a verifier file is configured. |
| `SHELF_ACCESS_HASH_FILE` | Alternative file containing the lowercase hexadecimal SHA-256 digest of the code. Configure exactly one authentication option. |
| `SHELF_DB_PATH` | Persistent SQLite database path. |
| `SHELF_PUBLISHER_PUBLIC_KEY_FILE` | PEM Ed25519 public key enabling signed imports. Without it, publishing is disabled. |
| `SHELF_DEMO_MODE` | Set to `1` for synthetic catalogs to show a visible demo label. Never enable for the real library. |
| `HOST`, `PORT` | Bind address and port. Defaults: `127.0.0.1`, `4174`. |

The browser remembers the access code in local storage until logout or browser
storage removal. It is sent in a header, never a URL or Redux state. Use HTTPS
for network access. This shared code does not provide individual user accounts.
Stop the server before copying SQLite for a simple consistent backup, or use a
SQLite-aware backup tool.

## Container

```sh
# Set SHELF_ACCESS_CODE in the untracked .env first.
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

Node tests cover signed imports, access control, validation, idempotence,
snapshot ordering, durable events, timestamp handling and pagination.
Optional browser regression specifications use synthetic API responses:

```sh
npx playwright install chromium
npm run test:ui
```

At initial implementation, type checking, production build and all eight Node
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
