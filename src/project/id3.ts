// Minimal ID3v2 reader for artist/title/cover art, used when starting a map from an mp3.

export interface Id3Tags {
  title?: string;
  artist?: string;
  picture?: Blob;
}

function decodeText(bytes: Uint8Array): string {
  const enc = bytes[0];
  const body = bytes.subarray(1);
  let text: string;
  if (enc === 1 || enc === 2) text = new TextDecoder(enc === 2 ? 'utf-16be' : 'utf-16').decode(body);
  else if (enc === 3) text = new TextDecoder('utf-8').decode(body);
  else text = new TextDecoder('latin1').decode(body);
  return text.replace(/\0+$/g, '').replace(/\0/g, ' ').trim();
}

function synchsafe(b: Uint8Array, o: number): number {
  return (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
}

export async function readId3(file: Blob): Promise<Id3Tags | null> {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return null;
  const version = head[3];
  const size = synchsafe(head, 6);
  const data = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
  const tags: Id3Tags = {};
  let o = 0;
  if (head[5] & 0x40) o += version === 4 ? synchsafe(data, 0) : ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) + 4;
  while (o + 10 <= data.length) {
    const id = String.fromCharCode(data[o], data[o + 1], data[o + 2], data[o + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const len = version === 4 ? synchsafe(data, o + 4) : (data[o + 4] << 24) | (data[o + 5] << 16) | (data[o + 6] << 8) | data[o + 7];
    const body = data.subarray(o + 10, o + 10 + len);
    if (id === 'TIT2') tags.title = decodeText(body);
    else if (id === 'TPE1') tags.artist = decodeText(body);
    else if (id === 'APIC' && !tags.picture) {
      const enc = body[0];
      let p = 1;
      const mimeEnd = body.indexOf(0, p);
      const mime = new TextDecoder('latin1').decode(body.subarray(p, mimeEnd)) || 'image/jpeg';
      p = mimeEnd + 2; // skip null + picture type
      if (enc === 1 || enc === 2) {
        while (p + 1 < body.length && !(body[p] === 0 && body[p + 1] === 0)) p += 2;
        p += 2;
      } else {
        while (p < body.length && body[p] !== 0) p++;
        p += 1;
      }
      tags.picture = new Blob([body.slice(p)], { type: mime.includes('/') ? mime : `image/${mime.toLowerCase()}` });
    }
    o += 10 + len;
  }
  return tags;
}
