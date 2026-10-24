// osu!direct in the browser: search published beatmaps, preview them and download straight into song select.
import { useEffect, useRef, useState } from 'react';
import { music } from '../audio/music';
import { editor } from '../editor/store';
import { PAGE_SIZE, searchBeatmapsets, type DirectQuery, type DirectSet, type DirectSort, type DirectStatus } from '../project/direct';
import { projectFromLink } from '../project/open';
import { starColour } from './filter';

const STATUSES: [DirectStatus, string][] = [
  ['ranked', 'Ranked'],
  ['loved', 'Loved'],
  ['qualified', 'Qualified'],
  ['pending', 'Pending'],
  ['graveyard', 'Graveyard'],
  ['any', 'Any'],
];
const MODES: [number | null, string][] = [
  [0, 'osu!'],
  [1, 'osu!taiko'],
  [2, 'osu!catch'],
  [3, 'osu!mania'],
  [null, 'All modes'],
];
const SORTS: [DirectSort, string][] = [
  ['plays', 'Most played'],
  ['favourites', 'Most favourited'],
  ['ranked', 'Recently ranked'],
  ['newest', 'Newest'],
];

type Download = { progress: number; error?: string; projectId?: string };

interface Props {
  /** Beatmapset id → local project id, for sets already in song select. */
  have: Map<number, string>;
  onImported: (projectId: string) => Promise<void>;
  onOpen: (projectId: string) => void;
  onClose: () => void;
}

function formatLength(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function formatCount(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);
}

export function DirectPanel({ have, onImported, onOpen, onClose }: Props) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState<Omit<DirectQuery, 'offset'>>({ query: '', mode: 0, status: 'ranked', sort: 'plays' });
  const [results, setResults] = useState<DirectSet[]>([]);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<Map<number, Download>>(new Map());
  const [playing, setPlaying] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const request = useRef<AbortController | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const state = useRef({ loading, more, results, query });
  state.current = { loading, more, results, query };

  const load = async (q: Omit<DirectQuery, 'offset'>, offset: number) => {
    request.current?.abort();
    const ctrl = new AbortController();
    request.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const page = await searchBeatmapsets({ ...q, offset }, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setResults((r) => (offset === 0 ? page : [...r, ...page.filter((s) => !r.some((x) => x.id === s.id))]));
      setMore(page.length >= PAGE_SIZE);
    } catch (e) {
      if (!ctrl.signal.aborted) setError((e as Error).message);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  };

  // New search when the filters change; typing waits a moment.
  useEffect(() => {
    void load(query, 0);
  }, [query]);
  useEffect(() => {
    if (text === query.query) return;
    const t = window.setTimeout(() => setQuery((q) => ({ ...q, query: text })), 350);
    return () => window.clearTimeout(t);
  }, [text]);

  // Next page when the end of the list scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      const s = state.current;
      if (entries[0].isIntersecting && !s.loading && s.more && s.results.length) void load(s.query, s.results.length);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    music.pause();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      request.current?.abort();
      audio.current?.pause();
    };
  }, [onClose]);

  const togglePreview = (s: DirectSet) => {
    audio.current ??= new Audio();
    const a = audio.current;
    if (playing === s.id) {
      a.pause();
      setPlaying(null);
      return;
    }
    music.pause();
    a.src = s.preview;
    a.volume = editor.prefs.masterVolume * editor.prefs.musicVolume;
    a.onended = () => setPlaying(null);
    a.play().then(
      () => setPlaying(s.id),
      () => setPlaying(null),
    );
  };

  const setDownload = (id: number, d: Download | null) =>
    setDownloads((m) => {
      const n = new Map(m);
      if (d) n.set(id, d);
      else n.delete(id);
      return n;
    });

  const download = async (id: number, label: string) => {
    setDownload(id, { progress: 0 });
    let last = 0;
    try {
      const p = await projectFromLink(String(id), (f) => {
        // Keep re-renders to a few per second.
        if (f - last < 0.02 && f < 1) return;
        last = f;
        setDownload(id, { progress: f });
      });
      setDownload(id, { progress: 1, projectId: p.id });
      await onImported(p.id);
      editor.toast(`Downloaded ${label}.`);
    } catch (e) {
      setDownload(id, { progress: 0, error: (e as Error).message });
      editor.toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="dl" onDragOver={(e) => e.stopPropagation()}>
      <div className="dl-top">
        <span className="dl-title">osu!direct</span>
        <input
          autoFocus
          className="dl-search"
          placeholder="Search artist, title, mapper, tags… (or paste a beatmap link)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const link = /beatmapsets\/(\d+)/.exec(text);
              if (link) void download(Number(link[1]), `beatmapset ${link[1]}`);
              else setQuery((q) => ({ ...q, query: text }));
            }
          }}
        />
        <button className="dl-close" onClick={onClose} title="Close (Esc)">×</button>
      </div>
      <div className="dl-filters">
        <div className="dl-chips">
          {STATUSES.map(([v, label]) => (
            <button key={v} className={query.status === v ? 'active' : ''} onClick={() => setQuery((q) => ({ ...q, status: v }))}>{label}</button>
          ))}
        </div>
        <div className="dl-chips">
          {MODES.map(([v, label]) => (
            <button key={label} className={query.mode === v ? 'active' : ''} onClick={() => setQuery((q) => ({ ...q, mode: v }))}>{label}</button>
          ))}
        </div>
        <select value={query.sort} onChange={(e) => setQuery((q) => ({ ...q, sort: e.target.value as DirectSort }))}>
          {SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>
      <div className="dl-list">
        {results.map((s) => {
          const d = downloads.get(s.id);
          const local = d?.projectId ?? have.get(s.id);
          const diffs = query.mode === null ? s.difficulties : s.difficulties.filter((x) => x.mode === query.mode);
          const length = Math.max(0, ...s.difficulties.map((x) => x.length));
          return (
            <div key={s.id} className="dl-set" style={{ backgroundImage: `linear-gradient(90deg, rgba(0,0,0,0.85) 30%, rgba(0,0,0,0.45)), url("${s.card}")` }}>
              <button className={`dl-preview ${playing === s.id ? 'playing' : ''}`} onClick={() => togglePreview(s)} title="Preview">
                {playing === s.id ? '■' : '▶'}
              </button>
              <div className="dl-info">
                <div className="dl-name">{s.artist} - {s.title}</div>
                <div className="dl-meta">
                  mapped by <b>{s.creator}</b>
                  <span className={`dl-status ${s.status}`}>{s.status}</span>
                  <span>{Math.round(s.bpm)} BPM</span>
                  <span>{formatLength(length)}</span>
                  <span title="Plays">▶ {formatCount(s.plays)}</span>
                  <span title="Favourites">♥ {formatCount(s.favourites)}</span>
                  {s.video && <span>video</span>}
                  {s.storyboard && <span>storyboard</span>}
                </div>
                <div className="dl-diffs">
                  {diffs.map((x) => (
                    <span key={x.id} className="dl-diff" style={{ background: starColour(x.stars) }} title={`${x.version} (${x.stars.toFixed(2)}★)`} />
                  ))}
                </div>
              </div>
              <div className="dl-action">
                {local ? (
                  <button className="dl-open" onClick={() => onOpen(local)}>Open</button>
                ) : d && !d.error ? (
                  <div className="dl-progress"><div style={{ width: `${Math.round(d.progress * 100)}%` }} /><span>{Math.round(d.progress * 100)}%</span></div>
                ) : (
                  <button className="dl-get" onClick={() => void download(s.id, `${s.artist} - ${s.title}`)} title={d?.error}>{d?.error ? 'Retry' : 'Download'}</button>
                )}
              </div>
            </div>
          );
        })}
        <div ref={sentinel} className="dl-end">
          {error ? error : loading ? 'Searching…' : results.length === 0 ? 'No beatmaps found.' : more ? '' : 'That’s all of them.'}
        </div>
      </div>
      <div className="dl-credit">Search by osu.direct, downloads from osu.direct / nerinyan.moe mirrors. Maps are saved in this browser.</div>
    </div>
  );
}
