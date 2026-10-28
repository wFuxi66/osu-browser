import { useEffect, useState } from 'react';
import { useTouch } from './touch';

/** The editor needs a landscape screen: on a phone held upright, ask for it to be turned. */
export function RotateHint() {
  const touch = useTouch();
  const [portrait, setPortrait] = useState(() => matchMedia('(orientation: portrait)').matches);
  useEffect(() => {
    const mq = matchMedia('(orientation: portrait)');
    const on = () => setPortrait(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  if (!touch || !portrait) return null;
  return (
    <div className="rotate-hint">
      <svg viewBox="0 0 24 24" className="rotate-hint-icon" aria-hidden="true">
        <rect x="7" y="2" width="10" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3 9a9 9 0 0 1 3-5M21 15a9 9 0 0 1-3 5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
      <div>Rotate your device to landscape</div>
    </div>
  );
}

/** Fullscreen hides the browser bars (Android); also locks landscape where the browser allows it. */
export async function enterFullscreen() {
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
  } catch {
    // Refused or unsupported: the page still works in the browser window.
  }
}

export function FullscreenButton() {
  const touch = useTouch();
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  if (!touch || full || !document.fullscreenEnabled) return null;
  return (
    <button className="fullscreen-btn" onClick={() => void enterFullscreen()} title="Fullscreen">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    </button>
  );
}
