// Stable's main menu: the big cookie pulsing to the song with a visualiser around it; clicking it slides out Play,
// Edit, Options and Exit. The top bar has the user panel, a few lines of info and the Now Playing music controls; the
// osu!direct tab sits on the right edge.
import { useEffect, useRef, useState } from 'react';
import { useCloud } from '../App';
import { music } from '../audio/music';
import { waveformFor, WAVEFORM_BUCKET_MS } from '../audio/waveform';
import { useEditor } from '../editor/store';
import { controlPointAt, redLineAt } from '../osu/timing';
import type { Beatmap } from '../osu/types';
import { cloud } from '../project/cloud';
import { listProjectsLocal, loadProjectLocal, type ProjectSummary } from '../project/storage';
import { scores, useScores } from '../play/scores';
import { accountDialog } from '../songselect/SongSelect';
import { options, optionsOpen } from '../ui/options';
import { promptOpen } from '../ui/prompt';
import { screens } from '../ui/screens';
import { layoutCode } from '../editor/shortcuts';
import { nowPlaying } from './nowPlaying';

const TIPS = [
  'Press F1 in song select to choose mods, and Ctrl+Enter to watch an autoplay of the selected map.',
  'In the editor, F5 test-plays the map from the current time. Esc brings you back.',
  'Your scores stay in this browser: they are there to test your own maps.',
  'Alt + mouse wheel changes the volume. While playing, the wheel alone does.',
  'Press ` (the key under Esc) to quickly retry a map.',
  'Connect Google Drive in Options to find your maps on any computer.',
  'Right-click a score in the local ranking to delete it.',
  'Shift+Delete in song select deletes the selected beatmap.',
  'Hold Shift while dragging in the editor to snap to more angles.',
  'Every editor shortcut can be rebound in Options → Input.',
  'You can drop an .osz or a skin straight onto the window.',
];

const urlCache = new WeakMap<Blob, string>();
const blobUrl = (b: Blob | null) => {
  if (!b) return null;
  let u = urlCache.get(b);
  if (!u) urlCache.set(b, (u = URL.createObjectURL(b)));
  return u;
};

const startedAt = Date.now();

function since(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.floor(s / 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`.replace(/^00:/, '');
}

export function MainMenu() {
  const ed = useEditor();
  useCloud();
  useScores();
  const [sets, setSets] = useState<ProjectSummary[] | null>(null);
  const [current, setCurrent] = useState<ProjectSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState<null | 'bye' | 'out'>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  const history = useRef<string[]>([]);
  const timing = useRef<Beatmap | null>(null);
  const cookie = useRef<HTMLButtonElement>(null);
  const viz = useRef<HTMLCanvasElement>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const idle = useRef(0);

  useEffect(() => {
    void listProjectsLocal().then(setSets, () => setSets([]));
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  // ---------------------------------------------------------------- the song
  const playSet = async (s: ProjectSummary, fromPreview = true) => {
    setCurrent(s);
    nowPlaying.setId = s.id;
    nowPlaying.diffId = s.difficulties[0]?.id ?? null;
    if (!s.audio) return;
    if (music.blob !== s.audio) await music.load(s.audio);
    music.rate = 1;
    if (fromPreview) {
      const p = s.difficulties[0]?.previewTime ?? -1;
      music.seek(p >= 0 ? p : (music.duration || 0) * 0.4);
    }
    music.fadeIn(800);
    await music.play();
  };
  const next = () => {
    if (!sets?.length) return;
    if (current) history.current.push(current.id);
    const others = sets.filter((s) => s.id !== current?.id && s.audio);
    const pick = others[Math.floor(Math.random() * others.length)] ?? sets[0];
    void playSet(pick);
  };
  const prev = () => {
    const id = history.current.pop();
    const s = sets?.find((x) => x.id === id);
    if (s) void playSet(s);
    else if (current) void playSet(current);
  };

  useEffect(() => {
    if (!sets) return;
    // Carry on with what's playing (back from song select), else the shared song, else a random one.
    const playingSet = sets.find((s) => s.audio && s.audio === music.blob);
    if (playingSet && music.playing) {
      setCurrent(playingSet);
      nowPlaying.setId = playingSet.id;
      return;
    }
    const shared = sets.find((s) => s.id === nowPlaying.setId);
    const withAudio = sets.filter((s) => s.audio);
    const pick = shared ?? withAudio[Math.floor(Math.random() * withAudio.length)];
    if (pick) void playSet(pick, pick.audio !== music.blob || music.time < 1);
    // Browsers block autoplay until the first click/key.
    const kick = () => !music.playing && music.blob && void music.play();
    window.addEventListener('pointerdown', kick, { once: true });
    window.addEventListener('keydown', kick, { once: true });
    return () => {
      window.removeEventListener('pointerdown', kick);
      window.removeEventListener('keydown', kick);
    };
  }, [sets]);

  // At the end of the song, another one.
  const nextRef = useRef(next);
  nextRef.current = next;
  useEffect(
    () =>
      music.onChange(() => {
        if (!music.playing && music.duration && music.time >= music.duration - music.offset - 30) nextRef.current();
      }),
    [],
  );

  // The song's timing, for the cookie's beat and kiai.
  useEffect(() => {
    timing.current = null;
    if (!current) return;
    let live = true;
    void loadProjectLocal(current.id).then((p) => {
      if (live && p) timing.current = p.difficulties[0]?.beatmap ?? null;
    });
    return () => {
      live = false;
    };
  }, [current?.id]);

  // ---------------------------------------------------------------- cookie pulse and visualiser
  useEffect(() => {
    let raf = 0;
    let smooth = new Float32Array(200);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const t = music.time;
      const bm = timing.current;
      let beat = 0;
      let kiai = false;
      if (bm && music.playing) {
        const red = redLineAt(bm, t);
        if (red.beatLength > 0) {
          const b = (t - red.time) / red.beatLength;
          beat = 1 - (b - Math.floor(b));
        }
        kiai = controlPointAt(bm, t).kiai;
      }
      const el = cookie.current;
      if (el) {
        el.style.setProperty('--beat', (beat ** 4).toFixed(3));
        el.classList.toggle('kiai', kiai);
      }
      const c = viz.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const wave = music.blob && music.playing ? waveformFor(music.blob) : null;
      const n = smooth.length;
      const next = new Float32Array(n);
      if (wave) {
        const at = Math.floor(t / WAVEFORM_BUCKET_MS);
        // Each bar follows the song's loudness a little later than its neighbour, which makes the ring "move" like
        // stable's spectrum.
        for (let i = 0; i < n; i++) {
          const j = at - ((i * 7) % 40);
          const v = wave.peaks[Math.max(0, Math.min(wave.peaks.length - 1, j))] ?? 0;
          const wobble = 0.55 + 0.45 * Math.sin(i * 1.7 + t / 160) * Math.sin(i * 0.31 + t / 410);
          next[i] = v * v * wobble;
        }
      }
      for (let i = 0; i < n; i++) smooth[i] = Math.max(next[i], smooth[i] * 0.88);
      const r0 = Math.min(w, h) * 0.3;
      const rot = t / 4000;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = Math.max(2, r0 * 0.022);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = rot + (i / n) * Math.PI * 2;
        const len = smooth[i] * r0 * 0.75;
        if (len < 1) continue;
        ctx.moveTo(w / 2 + Math.cos(a) * r0, h / 2 + Math.sin(a) * r0);
        ctx.lineTo(w / 2 + Math.cos(a) * (r0 + len), h / 2 + Math.sin(a) * (r0 + len));
      }
      ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---------------------------------------------------------------- actions
  const go = (to: 'play' | 'edit' | 'direct') => {
    setLeaving('out');
    window.setTimeout(() => (to === 'direct' ? screens.select('edit', true) : screens.select(to)), 180);
  };
  const exit = () => {
    setLeaving('bye');
    music.fadeOut(1400);
    window.setTimeout(() => {
      window.close();
      // Tabs the page didn't open can't be closed: back to the menu then.
      setLeaving(null);
      setOpen(false);
      music.fadeIn(600);
    }, 1600);
  };

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyHandler.current = (e) => {
    if (promptOpen() || optionsOpen() || leaving) return;
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    idle.current = Date.now();
    const code = layoutCode(e);
    if ((e.ctrlKey || e.metaKey) && code === 'KeyO') {
      e.preventDefault();
      options.show();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') setOpen(false);
    else if (code === 'KeyP' || (open && e.key === 'Enter')) go('play');
    else if (code === 'KeyE') go('edit');
    else if (code === 'KeyO') options.show();
    else if (code === 'KeyD') go('direct');
    else if (e.key === 'Enter' || code === 'Space') setOpen(true);
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  // The buttons fold back after a while without input, like stable.
  useEffect(() => {
    if (!open) return;
    idle.current = Date.now();
    const t = window.setInterval(() => {
      if (Date.now() - idle.current > 15000 && !optionsOpen()) setOpen(false);
    }, 1000);
    return () => window.clearInterval(t);
  }, [open]);

  const p = ed.prefs;
  const bg = blobUrl(current?.background ?? null);
  const px = p.menuParallax ? mouse.x : 0;
  const py = p.menuParallax ? mouse.y : 0;
  const totals = scores.totals();
  const u = cloud.user;
  const count = sets?.reduce((n, s) => n + s.difficulties.length, 0) ?? 0;
  const now = new Date();
  const buttons = [
    { id: 'play', label: 'Play', sub: 'Enjoy some beat-clicking action!', icon: <PlayIcon />, run: () => go('play') },
    { id: 'edit', label: 'Edit', sub: 'Make a beatmap, or change one.', icon: <EditIcon />, run: () => go('edit') },
    { id: 'options', label: 'Options', sub: 'Change the way the game behaves.', icon: <OptionsIcon />, run: () => options.show() },
    { id: 'exit', label: 'Exit', sub: 'See you next time!', icon: <ExitIcon />, run: exit },
  ];

  return (
    <div
      className={`mm ${open ? 'open' : ''} ${leaving === 'out' ? 'leaving' : ''}`}
      onPointerMove={(e) => {
        idle.current = Date.now();
        setMouse({ x: (e.clientX / window.innerWidth - 0.5) * 2, y: (e.clientY / window.innerHeight - 0.5) * 2 });
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && open) setOpen(false);
      }}
    >
      <div className="mm-bg" style={{ transform: `translate(${-px * 12}px, ${-py * 12}px) scale(1.04)` }}>
        {bg ? <img key={bg} src={bg} alt="" /> : <div className="mm-bg-default" />}
      </div>

      <div className="mm-centre" style={{ transform: `translate(${-px * 5}px, ${-py * 5}px)` }}>
        <div className="mm-logo-wrap">
          <canvas ref={viz} className="mm-viz" />
          <div className="mm-buttons" onMouseLeave={() => setHover(null)}>
            {buttons.map((b, i) => (
              <button key={b.id} className={`mm-btn ${hover === b.id ? 'hover' : ''}`} style={{ transitionDelay: open ? `${i * 30}ms` : '0ms' }} onMouseEnter={() => setHover(b.id)} onClick={b.run} tabIndex={open ? 0 : -1}>
                <span className="mm-btn-label">{b.label}</span>
                <span className="mm-btn-sub">{b.sub}</span>
                <span className="mm-btn-icon">{b.icon}</span>
              </button>
            ))}
          </div>
          <button ref={cookie} className="mm-cookie" onClick={() => (open ? go('play') : setOpen(true))} aria-label={open ? 'Play' : 'Open the menu'}>
            <span className="mm-cookie-inner">
              <span className="mm-cookie-text">osu!</span>
            </span>
          </button>
        </div>
      </div>

      <header className="mm-top">
        <button className="mm-user" onClick={() => void accountDialog(() => go('direct'))}>
          <span className="mm-user-avatar">{u?.avatarUrl ? <img src={u.avatarUrl} alt="" /> : <span>?</span>}</span>
          <span className="mm-user-text">
            <span className="mm-user-name">{u?.username ?? (p.creatorName || 'Guest')}</span>
            <span>Plays: {totals.plays.toLocaleString()}</span>
            <span>Accuracy: {(totals.accuracy * 100).toFixed(2)}%</span>
            <span>Total score: {totals.totalScore.toLocaleString()}</span>
          </span>
        </button>
        <div className="mm-info">
          <div>You have {count.toLocaleString()} beatmap{count === 1 ? '' : 's'} available!</div>
          <div>osu! has been running for {since(Date.now() - startedAt)}.</div>
          <div>It is currently {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.</div>
        </div>
        <div className="mm-np">
          <div className="mm-np-title">
            <span className="mm-np-label">Now Playing</span>
            <span className="mm-np-note">♪</span>
            <span className="mm-np-song">{current ? `${current.artist} - ${current.songTitle}` : 'Nothing yet'}</span>
          </div>
          <div className="mm-np-controls">
            <button title="Previous" onClick={prev}><svg viewBox="0 0 24 24"><path d="M6 5h2.5v14H6zM20 5v14L9 12z" /></svg></button>
            <button title="Play" onClick={() => void music.play()}><svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z" /></svg></button>
            <button title="Pause" onClick={() => music.pause()}><svg viewBox="0 0 24 24"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z" /></svg></button>
            <button title="Stop" onClick={() => music.stop()}><svg viewBox="0 0 24 24"><path d="M5 5h14v14H5z" /></svg></button>
            <button title="Next" onClick={next}><svg viewBox="0 0 24 24"><path d="M4 5v14l11-7zM15.5 5H18v14h-2.5z" /></svg></button>
          </div>
          <NpProgress />
        </div>
      </header>

      <button className="mm-direct" onClick={() => go('direct')} title="Search & download beatmaps (D)">
        <span className="mm-direct-arrow">▼</span>
        <span className="mm-direct-text">osu!direct</span>
      </button>

      <footer className="mm-bottom">
        <div className="mm-brand">
          <b>osu-browser</b>
          <span>osu! in a browser tab</span>
        </div>
        {p.menuTips && <div className="mm-tip">{tip}</div>}
      </footer>

      {leaving === 'bye' && <div className="mm-bye">See you next time!</div>}
    </div>
  );
}

function NpProgress() {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const step = () => {
      raf = requestAnimationFrame(step);
      setV(music.duration ? Math.max(0, Math.min(1, music.time / music.duration)) : 0);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      className="mm-np-progress"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (music.duration) music.seek(((e.clientX - r.left) / r.width) * music.duration);
      }}
    >
      <div style={{ width: `${v * 100}%` }} />
    </div>
  );
}

const PlayIcon = () => (
  <svg viewBox="0 0 64 48" fill="none" stroke="currentColor" strokeWidth="3.5">
    <circle cx="22" cy="30" r="12" />
    <text x="22" y="36" fontSize="16" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="700">1</text>
    <circle cx="44" cy="16" r="12" />
    <text x="44" y="22" fontSize="16" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="700">2</text>
  </svg>
);
const EditIcon = () => (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3.5">
    <circle cx="22" cy="22" r="11" />
    <path d="M9 9h5M9 9v5M35 9h-5M35 9v5M9 35h5M9 35v-5" strokeDasharray="0" />
    <path d="M26 26l14 14-5 1-3 5z" fill="currentColor" />
  </svg>
);
const OptionsIcon = () => (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3.5">
    <rect x="6" y="6" width="18" height="18" />
    <path d="M10 15l4 4 8-10" />
    <rect x="24" y="24" width="18" height="18" />
    <path d="M28 28l10 10M38 28L28 38" />
  </svg>
);
const ExitIcon = () => (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3.5">
    <rect x="13" y="4" width="22" height="40" fill="currentColor" fillOpacity="0.9" />
    <circle cx="30" cy="25" r="1.5" fill="#7b5cd6" stroke="none" />
  </svg>
);

