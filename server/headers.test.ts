import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS } from './headers.ts';

describe('security headers', () => {
  it('vercel.json sends the same headers as the Node server, on every path', () => {
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
      headers: { source: string; headers: { key: string; value: string }[] }[];
    };
    const all = config.headers.find((h) => h.source === '/(.*)');
    expect(Object.fromEntries(all!.headers.map((h) => [h.key, h.value]))).toEqual(SECURITY_HEADERS);
  });

  it('only runs scripts from the app itself', () => {
    const csp = SECURITY_HEADERS['Content-Security-Policy'];
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval';");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});
