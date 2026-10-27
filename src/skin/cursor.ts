// The skin's cursor (with cursormiddle) as the page's mouse cursor, as stable shows it on every screen. Sized like
// gameplay's (one SD skin pixel = height / 768 screen pixels, times the cursor size option), but browsers ignore
// cursor images over 128px, so bigger ones are scaled down to that. It is always the chosen skin's: the editor's
// osu!default option only changes what the playfield is drawn with.
import { skins } from './skin';

const MAX = 128;

export function applySkinCursor(cursorSize: number) {
  const root = document.documentElement;
  const skin = skins.chosen;
  const cursor = skin?.get('cursor');
  if (!skin || !cursor) {
    root.classList.remove('skin-cursor');
    return;
  }
  const middle = skin.get('cursormiddle');
  const k = Math.min((innerHeight / 768) * cursorSize, MAX / Math.max(cursor.w, cursor.h, middle?.w ?? 0, middle?.h ?? 0));
  const w = Math.max(1, Math.round(Math.max(cursor.w, middle?.w ?? 0) * k));
  const h = Math.max(1, Math.round(Math.max(cursor.h, middle?.h ?? 0) * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  for (const t of middle ? [cursor, middle] : [cursor]) ctx.drawImage(t.image, (w - t.w * k) / 2, (h - t.h * k) / 2, t.w * k, t.h * k);
  // CursorCentre: 0 puts the hotspot at the top-left corner.
  const [hx, hy] = skin.ini.cursorCentre ? [Math.round(w / 2), Math.round(h / 2)] : [0, 0];
  root.style.setProperty('--skin-cursor', `url(${c.toDataURL()}) ${hx} ${hy}, auto`);
  root.classList.add('skin-cursor');
}
