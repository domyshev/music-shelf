import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const codeLifetime = 10 * 60;
export const sessionLifetime = 30 * 24 * 60 * 60;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export class AuthError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); }
}
export interface LoginMailer { send(email: string, code: string, challengeId: string): Promise<void> }

export class EmailAuth {
  private db: DatabaseSync;
  constructor(path: string, private secret: Buffer, private now: () => number = Date.now) {
    if (secret.length < 32) throw new Error('Authentication secret must contain at least 32 bytes');
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS auth_codes (id TEXT PRIMARY KEY,email TEXT NOT NULL,digest TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,sent INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS auth_code_email ON auth_codes(email);
      CREATE TABLE IF NOT EXISTS auth_sessions (digest TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_limits (key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);`);
  }
  close() { this.db.close(); }
  private hash(value: string) { return createHmac('sha256', this.secret).update(value).digest('hex'); }
  private limit(key: string, maximum: number, seconds: number) {
    const id = this.hash(key);
    const row = this.db.prepare('SELECT count,expires FROM auth_limits WHERE key=?').get(id) as { count: number; expires: number } | undefined;
    if (row && row.expires > this.now() && row.count >= maximum) throw new AuthError(429, 'Too many attempts. Please try again later.', Math.ceil((row.expires - this.now()) / 1000));
    this.db.prepare('INSERT INTO auth_limits(key,count,expires) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,expires=excluded.expires').run(id, row && row.expires > this.now() ? row.count + 1 : 1, row && row.expires > this.now() ? row.expires : this.now() + seconds * 1000);
  }
  issue(email: string, ip: string) {
    this.db.prepare('DELETE FROM auth_codes WHERE expires<=?').run(this.now());
    this.db.prepare('DELETE FROM auth_sessions WHERE expires<=?').run(this.now());
    this.db.prepare('DELETE FROM auth_limits WHERE expires<=?').run(this.now());
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.limit(`email-minute:${email}`, 1, 60);
      this.limit(`email-hour:${email}`, 5, 3600);
      this.limit(`ip-hour:${ip}`, 30, 3600);
      this.limit('global-day', 100, 86400);
      const challengeId = randomBytes(24).toString('base64url');
      const code = String(randomInt(1000000)).padStart(6, '0');
      this.db.prepare('INSERT INTO auth_codes(id,email,digest,expires) VALUES (?,?,?,?)').run(challengeId, email, this.hash(`${challengeId}:${code}`), this.now() + codeLifetime * 1000);
      this.db.exec('COMMIT');
      return { challengeId, code };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  delivered(id: string) {
    this.db.prepare('DELETE FROM auth_codes WHERE email=(SELECT email FROM auth_codes WHERE id=?) AND id<>?').run(id, id);
    this.db.prepare('UPDATE auth_codes SET sent=1 WHERE id=?').run(id);
  }
  deliveryFailed(id: string) { this.db.prepare('DELETE FROM auth_codes WHERE id=?').run(id); }
  verify(id: string, code: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT * FROM auth_codes WHERE id=?').get(id) as { email: string; digest: string; expires: number; attempts: number; sent: number } | undefined;
      if (!row || !row.sent || row.expires <= this.now() || row.attempts >= 5) throw new AuthError(400, 'Invalid or expired code. Request a new one.');
      if (!timingSafeEqual(Buffer.from(row.digest, 'hex'), Buffer.from(this.hash(`${id}:${code}`), 'hex'))) {
        this.db.prepare('UPDATE auth_codes SET attempts=attempts+1 WHERE id=?').run(id);
        this.db.exec('COMMIT');
        throw new AuthError(400, 'Invalid or expired code. Request a new one.');
      }
      this.db.prepare('DELETE FROM auth_codes WHERE id=?').run(id);
      const token = randomBytes(32).toString('base64url');
      this.db.prepare('INSERT INTO auth_sessions(digest,email,expires) VALUES (?,?,?)').run(digest(token), row.email, this.now() + sessionLifetime * 1000);
      this.db.exec('COMMIT');
      return { token, email: row.email };
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }
  session(token: string) {
    const row = this.db.prepare('SELECT email FROM auth_sessions WHERE digest=? AND expires>?').get(digest(token), this.now()) as { email: string } | undefined;
    return row?.email;
  }
  logout(token: string) { this.db.prepare('DELETE FROM auth_sessions WHERE digest=?').run(digest(token)); }
}

export function resendMailer(apiKey: string, from: string, transport: typeof fetch = fetch): LoginMailer {
  if (!apiKey || !from) throw new Error('Configure RESEND_API_KEY and EMAIL_FROM');
  return { async send(email, code, challengeId) {
    const response = await transport('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `music-shelf-login/${challengeId}` },
      body: JSON.stringify({ from, to: [email], subject: 'Your Music Shelf sign-in code', text: `Your Music Shelf sign-in code is ${code}.\n\nIt expires in 10 minutes. If you did not request this code, ignore this email.`, html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto"><h1>music shelf</h1><p>Your sign-in code:</p><p style="font-size:32px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. If you did not request it, ignore this email.</p></div>` }),
    });
    // Provider responses may contain personal data; never forward or log them.
    if (!response.ok) throw new Error('Email delivery failed');
  } };
}
