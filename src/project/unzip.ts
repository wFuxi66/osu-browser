// Reading .osz packages with the browser's own inflate: on a 60 MB set JSZip's JavaScript inflate took seconds
// of main-thread time. Stored entries are slices of the package (nothing is copied) and deflated ones go
// through DecompressionStream. Anything this doesn't handle (zip64, encryption, other methods) returns null,
// and the caller falls back to JSZip.

export interface ZipEntry {
  name: string;
  /** The entry's contents, typed `type`. */
  blob(type: string): Promise<Blob>;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const UNICODE_PATH = 0x7075;

export async function readZip(zip: Blob): Promise<ZipEntry[] | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  // The end-of-central-directory record is in the last 22 bytes, plus a comment of up to 64 KiB.
  const tailStart = Math.max(0, zip.size - 22 - 0xffff);
  const tail = new DataView(await zip.slice(tailStart).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return null; // zip64
  const cd = new DataView(await zip.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const utf8 = new TextDecoder();
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let k = 0; k < count; k++) {
    if (at + 46 > cd.byteLength || cd.getUint32(at, true) !== CENTRAL) return null;
    const flags = cd.getUint16(at + 8, true);
    const method = cd.getUint16(at + 10, true);
    const compressed = cd.getUint32(at + 20, true);
    const nameLen = cd.getUint16(at + 28, true);
    const extraLen = cd.getUint16(at + 30, true);
    const commentLen = cd.getUint16(at + 32, true);
    const local = cd.getUint32(at + 42, true);
    if (flags & 1 || (method !== 0 && method !== 8)) return null;
    let name = utf8.decode(new Uint8Array(cd.buffer, at + 46, nameLen));
    // Names not flagged UTF-8 may carry an Info-ZIP Unicode Path field (JSZip reads it too).
    if (!(flags & 0x800)) {
      for (let e = at + 46 + nameLen, end = e + extraLen; e + 4 <= end; ) {
        const id = cd.getUint16(e, true);
        const len = cd.getUint16(e + 2, true);
        if (id === UNICODE_PATH && len > 5 && cd.getUint8(e + 4) === 1) name = utf8.decode(new Uint8Array(cd.buffer, e + 9, len - 5));
        e += 4 + len;
      }
    }
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    entries.push({
      name,
      async blob(type) {
        // The local header's name and extra field lengths can differ from the central directory's.
        const head = new DataView(await zip.slice(local, local + 30).arrayBuffer());
        if (head.byteLength < 30 || head.getUint32(0, true) !== LOCAL) throw new Error(`Damaged zip entry: ${name}`);
        const start = local + 30 + head.getUint16(26, true) + head.getUint16(28, true);
        const data = zip.slice(start, start + compressed, type);
        if (method === 0) return data;
        const body = data.stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Response(body, { headers: { 'Content-Type': type } }).blob();
      },
    });
  }
  return entries;
}
