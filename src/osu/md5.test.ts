import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { md5, md5Text } from './md5';

describe('md5', () => {
  it('matches the RFC 1321 test suite', () => {
    expect(md5Text('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5Text('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(md5Text('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5Text('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5Text('12345678901234567890123456789012345678901234567890123456789012345678901234567890')).toBe('57edf4a22be3c955ac49da2e2107b67a');
  });

  it('matches Node for every length around the block boundaries, and UTF-8 text', () => {
    for (let n = 0; n < 200; n++) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 31 + n) & 255);
      expect(md5(data)).toBe(createHash('md5').update(data).digest('hex'));
    }
    const text = '[Metadata]\r\nTitleUnicode:薬屋のひとりごと\r\n';
    expect(md5Text(text)).toBe(createHash('md5').update(text, 'utf8').digest('hex'));
  });
});
