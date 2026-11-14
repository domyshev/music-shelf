import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const tokenPattern = /^msu_[A-Za-z0-9_-]{43}$/;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

/** Credentials are scoped to the account that created them and never stored in plaintext. */
export class UploadKeys {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS upload_api_keys (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      digest TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS upload_api_keys_owner ON upload_api_keys(owner, created_at);`);
  }
  close() { this.db.close(); }
  create(owner: string, name: string) {
    const label = name.trim();
    if (!owner || !label || label.length > 100 || /[\u0000-\u001f\u007f]/u.test(label)) throw new Error('Invalid key name');
    const id = randomUUID();
    const token = `msu_${randomBytes(32).toString('base64url')}`;
    const createdAt = new Date().toISOString();
    this.db.prepare('INSERT INTO upload_api_keys(id,owner,name,digest,created_at) VALUES(?,?,?,?,?)').run(id, owner, label, digest(token), createdAt);
    return { id, name: label, createdAt, token };
  }
  list(owner: string) {
    return this.db.prepare('SELECT id,name,created_at AS createdAt,revoked_at AS revokedAt FROM upload_api_keys WHERE owner=? ORDER BY created_at DESC,id DESC').all(owner);
  }
  authenticate(token: string): { id: string; owner: string } | undefined {
    if (!tokenPattern.test(token)) return undefined;
    return this.db.prepare('SELECT id,owner FROM upload_api_keys WHERE digest=? AND revoked_at IS NULL').get(digest(token)) as {id:string;owner:string}|undefined;
  }
  revoke(owner: string, id: string) {
    return this.db.prepare('UPDATE upload_api_keys SET revoked_at=? WHERE id=? AND owner=? AND revoked_at IS NULL').run(new Date().toISOString(), id, owner).changes === 1;
  }
}
