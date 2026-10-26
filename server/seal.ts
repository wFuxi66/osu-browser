// Encrypted, tamper-proof cookie values (AES-256-GCM), so the server keeps no session or token tables.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** A sealer for one purpose; the key is derived from a server secret, so rotating the secret invalidates every value. */
export function sealer(secret: string, purpose: string) {
  const key = createHash('sha256').update(`${purpose}:${secret}`).digest();
  return {
    seal(text: string): string {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
    },
    open(sealed: string): string | null {
      try {
        const b = Buffer.from(sealed, 'base64url');
        // A pinned tag length: GCM would otherwise accept a truncated tag.
        const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12), { authTagLength: 16 });
        d.setAuthTag(b.subarray(12, 28));
        return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
      } catch {
        return null;
      }
    },
  };
}
