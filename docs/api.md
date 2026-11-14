# Catalog API

Browser APIs use same-origin session cookies. Upload clients can use scoped API keys, and the storage worker uses signed requests. Responses use JSON except the authenticated storage file stream. Music upload endpoints accept audio and ZIP files; no endpoint accepts a server output path or an external acquisition URL.

## Read endpoints

| Endpoint | Response |
| --- | --- |
| `GET /healthz` | Public `{ "ok": true }` liveness response. |
| `GET /api/session` | Authenticated `{ "ok": true }`. |
| `GET /api/catalog` | `{ generatedAt, tracks, stats: { total, ready, pending, sizeBytes } }`. |
| `GET /api/history?limit=100&cursor=...` | `{ events, nextCursor, total }`, newest first by timestamp and ID. |

History limits range from 1 to 500. Treat `nextCursor` as opaque, URL-encode it
and stop when null. Keyset pagination avoids shifting earlier pages when new
events arrive. Reopen history from the first page to see new or corrected events.
Invalid pagination returns 400. Unauthenticated reads return 401. Email-code request throttling returns 429
with Retry-After; its network limit uses the direct peer IP.

## Legacy snapshot import

The normal application entry point disables this endpoint. It is retained as an
explicit opt-in for migration tools using `createApp({publisherKey})`; the new
storage worker registers verified files incrementally and does not replace the
catalog. Do not enable snapshot replacement alongside active storage imports.


`POST /api/import` accepts a full JSON snapshot, up to 8 MiB and 10,000 tracks.
Configure the server with the publisher's PEM Ed25519 public key. The matching
private key belongs exclusively in the publisher's private configuration.

```text
Content-Type: application/json
X-Shelf-Timestamp: <Unix timestamp in seconds>
X-Shelf-Signature: <base64 Ed25519 signature>
```

Sign the ASCII timestamp, one newline byte, then the exact UTF-8 JSON body bytes.
Do not reserialize after signing. The request timestamp must be within five
minutes of the server clock. An external Node publisher can construct it as:

```js
import { sign } from 'node:crypto';
// privateKey is supplied by the publisher's private runtime configuration.
const body = Buffer.from(JSON.stringify(snapshot));
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = sign(null, Buffer.concat([
  Buffer.from(timestamp + '\n'), body,
]), privateKey).toString('base64');
// Send body unchanged with the three headers to your configured server.
```

Response: `{ ok: true, tracks: number, duplicate: boolean, eventsAdded: number }`.
An exact retry succeeds with `duplicate: true`. Older snapshots and changed
content at the current timestamp return 409. Use a strictly newer `generatedAt`
for changed metadata. Snapshot timestamps over five minutes in the future are
rejected. Invalid content/timestamps return 400, invalid signatures 403, oversized
bodies 413, and an unconfigured publisher 503.

A snapshot replaces the current catalog in one transaction. Omitted tracks
leave the catalog, but their events remain.

## Snapshot schema

The authoritative strict schema is [shared/catalog.ts](../shared/catalog.ts).
Unknown fields are rejected, including source URLs and server paths.

| Field | Type and meaning |
| --- | --- |
| `generatedAt` | ISO timestamp with timezone; normalized to UTC. |
| `tracks` | Array with unique, stable IDs. |
| `tracks[].id` | Nonempty identifier, up to 200 characters. |
| `title`, `artist` | Nonempty strings, up to 1,000 characters. |
| `album` | String, up to 1,000 characters; defaults to empty. |
| `year` | Original song year, integer 1800–2200, or null. |
| `status` | `ready` or `pending`. |
| `file` | Required object for ready tracks; null for pending tracks. |
| `queuedAt` | Optional source queue-entry timestamp or null; cannot follow `generatedAt`. |
| `completedAt` | Optional source completion timestamp or null; cannot follow `generatedAt`. |

Required file properties:

| Field | Type and meaning |
| --- | --- |
| `name` | Basename up to 512 characters; no path separators/control characters. |
| `sizeBytes` | Positive integer. |
| `sha256` | Lowercase 64-character hexadecimal SHA-256 of actual file bytes. |
| `format`, `codec` | Nonempty strings, up to 30 and 50 characters. |
| `sampleRate` | Positive integer, Hz. |
| `bitDepth` | Integer 0–64; 0 denotes unknown/non-applicable. |
| `channels` | Integer 1–64. |
| `durationSeconds` | Nonnegative number. |
| `bitrateBps` | Nonnegative integer; 0 denotes unknown. |

Measured properties should come from the actual file. Pending rows display
unknown properties as dashes. The public example's file values are fabricated.

## Event semantics

Events contain `id`, `trackId`, `title`, `artist`, `kind`, `occurredAt` and
`timeBasis`. Titles and artists are preserved when the event is created.

| Kind | Meaning |
| --- | --- |
| `queued` | First observation in the queue, or a supplied source queue timestamp. |
| `downloaded` | First completion with a source time, or newly observed ready status. |
| `imported` | Initial ready file without a known completion time. |
| `file_updated` | A ready track's checksum changed. |
| `unavailable` | A ready track became pending. |
| `restored` | A pending track became ready with an already known checksum. |

`timeBasis` is `source`, `observed` or `import`. Observed/import events use the
snapshot timestamp. A source completion time arriving later can correct an
initial import event in place. Identical file observations are deduplicated by
track ID and checksum. Changed checksums use the new observation time even when
an old completion date remains in the incoming metadata.

The API records metadata transitions. The private collector is responsible for
checking files on the actual music server.

Queue entries are deduplicated by stable track ID. A later source `queuedAt`
corrects an observed queue date in place. Distinct retry attempts require distinct
track IDs if they should appear as separate queue events. Initial ready files
only get a queue event when a source queue date is provided; no earlier queue
date is invented. `total` counts all persisted events, independently of the page.

## History filters

`GET /api/history` accepts `kind`, `from` and `to` alongside `limit` and `cursor`.
`kind` is a comma-separated list of event kinds (OR within the list); omitting it
includes every kind. `from` is an inclusive ISO timestamp with timezone, and `to`
is an exclusive one. They are combined with the event condition using AND.
Malformed kinds, timestamps and reversed/empty intervals return 400.

Filtering happens in SQLite before pagination. `total` counts all matching
records, independent of cursor and page size. Supply identical filters with each
cursor request. Changing a filter requires restarting without a cursor. Browser
calendar ranges are converted from local inclusive days to these UTC boundaries.

## Catalog pagination, search and filters

`GET /api/catalog` returns one page (100 rows by default). Query parameters:

- `page`: one-based page number; `pageSize`: 1–250 rows.
- `q`: case/diacritic-insensitive substring search across title, artist, album,
  original year and status. Literal punctuation is not interpreted as SQL syntax.
- `sort`: `position`, `status`, `title`, `artist`, `year`, `sampleRate`, `bitDepth`
  or `sizeBytes`; `direction`: `asc` or `desc`. Unknown properties sort last.
- `filters`: URL-encoded JSON object with optional `status`, `artist`, `year`
  arrays. Values match exactly, OR within each column and AND between columns.
  Year values are strings; an empty string selects an unknown year.

The response includes `pagination: { page, pageSize, total, pages }`, where total
counts all matching tracks, and `facets: { status, artist, year }`, containing
sorted unique choices from the entire catalog. `stats` continues to describe the
whole library. Search, filters, sorting and limiting run in SQLite before rows
are returned. No audio or private file paths are included. Existing browser
column filters continue to persist even though their execution is server-side.

## Email-code authentication

All authentication POSTs require an `Origin` header equal to `SHELF_ORIGIN`.
Bodies are strict JSON up to 8 KiB. Cross-origin requests return 403.

- `POST /api/auth/request-code` with `{ email }` sends a six-digit code and returns
  `{ ok, challengeId, expiresIn: 600, resendAfter: 60 }`. No code is returned.
- `POST /api/auth/verify-code` with `{ challengeId, code }` consumes a delivered
  code and returns `{ ok, email }`, setting an HttpOnly, SameSite=Lax session cookie.
  HTTPS uses the Secure, host-only `__Host-music-shelf-session` cookie.
- `GET /api/session` returns `{ ok, email }` for the current session, or 401.
- `POST /api/auth/logout` revokes the session and clears its cookie.

Codes expire after 10 minutes and lock after five failed attempts. A new delivered
code replaces older challenges for the email. Rate limits persist across restart:
one request/minute and five/hour per email, 30/hour per direct peer IP, 100/day
for the app. Verification creates a new random session, valid for 30 days. Provider
errors are generic and contain no credentials or provider response bodies.
The old X-Access-Code header has no effect. Signed imports are unchanged and do
not require browser cookies or Origin authentication.

### User song texts and AI

Authenticated sessions can read and update their own `GET`/`PUT`
`/api/tracks/:id/text` with `{ "originalLanguage": "en", "texts": { "en": "...", "ru": "..." } }`. Language keys are two or three lowercase letters. Legacy translations with unknown language are returned under `und`.
The data is kept separately from imported snapshots. Mutations require the
configured same origin.

`GET`/`PUT /api/ai/settings` reads token presence and model or updates
`{ "model": "...", "token": "..." }`; omit the token to keep it, or send
`removeToken: true` to remove it. A token is never returned by the API.
`GET /api/ai/models` lists OpenRouter models. `GET /api/ai/chat/history` returns
the signed-in account’s saved conversation in pages; the `before` cursor loads
earlier turns. `POST /api/ai/chat` accepts `{ "requestId": "<uuid>", "message": "..." }`,
stores the request and answer, and sends recent stored context to OpenRouter with
the user’s token. Request IDs are idempotent; concurrent turns for one account
are rejected. Interrupted turns are not automatically replayed.
Chat calls may incur provider costs. These endpoints require authentication;
mutations also require the configured origin.


## Music upload API

Owners are configured by `SHELF_UPLOAD_USERS` or `SHELF_UPLOAD_USERS_FILE`.
A signed-in owner can manage credentials using `GET /api/upload-keys`,
`POST /api/upload-keys` with JSON `{"name":"My agent"}`, and
`DELETE /api/upload-keys/:id`. Mutations require the exact browser Origin.
Creation returns a random `token` once. Only a digest is persisted. Revocation
is immediate. A key is limited to uploads and report reads for its account.

`POST /api/uploads` accepts `multipart/form-data` with repeated `files` fields.
Send `Authorization: Bearer <upload-key>`, or use an owner's browser session
with the configured Origin. Supply audio files or a single ZIP; mixing is rejected.
The request limit is 80 MiB. The server hashes original files and the ZIP itself;
archive contents retain their relative paths, file sizes and individual hashes.
SHA-256 identifies content, so duplicate bytes share a hash. Each request receives
a distinct UUID in `id`. Unsupported archive entries are reported as failed.

```sh
curl --fail-with-body -H "Authorization: Bearer $SHELF_UPLOAD_KEY"   -F 'files=@song.flac' 'https://your-shelf.example/api/uploads?wait=30'
```

`wait` is optional, from 0 to 30 seconds. While remote storage is pending the
response is HTTP 202 with `status: "staged"` and `success: null`. If confirmation
arrives during the wait, the response is HTTP 200 with a final report. Read
`GET /api/uploads/:id` to poll or `GET /api/uploads` for the newest 100 reports.
Both accept the same upload key or owner session. Other accounts cannot read a
report. Browser history and the agent's `upload_history` tool use these reports.

A report contains `id`, `createdAt`, `kind` (`archive` or `files`), `status`,
`success` and `files`. Each file includes `name`, `sizeBytes`, `sha256`, `status`,
`success`, and, when confirmed, `trackId`; failed files include an error code.
ZIP uploads additionally include `archive` with the original archive's checksum.
Final overall statuses are `complete`, `partial` and `failed`; per-file statuses
are `ready` or `failed`. Confirmed storage does not promise Navidrome has already
completed its next scan. Malformed or unsafe requests fail with HTTP 400 before
being queued. No API accepts external download URLs or music acquisition jobs.

### Storage worker protocol

Only the worker's configured Ed25519 public key authorizes `POST` requests to
`/api/storage/poll`, `/api/storage/file`, `/api/storage/complete` and
`/api/storage/register`. Sign `timestamp + "\n" + path + "\n" + raw JSON bytes`
and send `X-Shelf-Timestamp` and base64 `X-Shelf-Signature`. Bodies include a fresh
32-character hexadecimal `nonce`. Timestamp tolerance is 120 seconds; nonces are
persisted and cannot be replayed. Upload API keys do not authorize these routes.
The supplied worker implements this protocol. Existing catalog entries are
retained and identical audio hashes reuse their original identifiers.

The removed downloader routes `/api/bridge/*` and `/api/download/settings` return
HTTP 404. The assistant no longer exposes music-provider search, acquisition,
queue or retry-setting tools.
