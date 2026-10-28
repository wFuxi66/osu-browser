// Security headers for every response, page or API. The Node server adds them (server/index.ts); on Vercel the
// same list is in vercel.json, and headers.test.ts keeps the two in step.
//
// The CSP's job is script injection: scripts only from the app's own files (wasm for ffmpeg; the song worker is
// a blob). Downloads, images and audio may come from any https host, because the beatmap mirrors redirect to
// CDNs that change (sayobot's nodes even use their own ports), and an injected script could leak data through
// an image or a page load anyway.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: https:",
  "media-src 'self' blob: data: https:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data: https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  // Browser features the app never uses, so nothing injected can ask for them either.
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), midi=()',
};

/** Vercel adds HSTS on its own; the Node server only sends it when it's served over HTTPS. */
export const HSTS = 'max-age=31536000';
