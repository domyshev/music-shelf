# Catalog API

All endpoints are same-origin. Responses use JSON. Reading requires an authenticated session cookie. Publishing uses a separate
signature.
No endpoint accepts audio or private file paths.

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

## Publish a snapshot

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
