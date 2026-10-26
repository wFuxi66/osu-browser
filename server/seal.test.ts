import { describe, expect, it } from 'vitest';
import { sealer } from './seal.ts';

describe('sealer', () => {
  const s = sealer('secret', 'test');

  it('opens what it sealed, and nothing sealed for another purpose', () => {
    expect(s.open(s.seal('hello'))).toBe('hello');
    expect(sealer('secret', 'other').open(s.seal('hello'))).toBeNull();
  });

  it('rejects a value whose auth tag was cut short', () => {
    // iv (12) + the first 4 bytes of a real tag: GCM accepts such a tag unless its length is pinned.
    const short = Buffer.from(s.seal(''), 'base64url').subarray(0, 16).toString('base64url');
    expect(s.open(short)).toBeNull();
  });
});
