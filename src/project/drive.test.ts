import { afterEach, expect, it, vi } from 'vitest';
import { drive } from './drive';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('makes one folder in Drive for uploads that start at once', async () => {
  let folders = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    if (url === '/api/drive/token') return Response.json({ accessToken: 'token', expiresIn: 3600 });
    // Every search finds nothing yet: no folder, and no file for these maps.
    if (url.includes('/files?spaces=drive')) return Response.json({ files: [] });
    if (url.endsWith('/drive/v3/files?fields=id')) return Response.json({ id: `folder-${++folders}` });
    if (url.includes('uploadType=resumable')) return new Response(null, { headers: { Location: 'https://upload.example/session' } });
    if (url === 'https://upload.example/session') return Response.json({ id: 'file' });
    throw new Error(`unexpected request: ${url}`);
  });
  const meta = (id: string) => ({ id, createdAt: 1, updatedAt: 1, fileName: `${id}.osz`, description: '' });
  await Promise.all(['a', 'b', 'c'].map((id) => drive.upload(meta(id), new Blob(['osz']))));
  expect(folders).toBe(1);
});
