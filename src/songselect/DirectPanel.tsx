// osu!direct in the browser, laid out like stable's: search published beatmaps, preview them and download straight
// into song select. Logged in with osu!, the Display list also offers the user's own uploaded sets and guest
// difficulties.
import { useEffect, useRef, useState } from 'react';
import { music } from '../audio/music';
import { editor } from '../editor/store';
import { cloud } from '../project/cloud';
import { myBeatmapsets, PAGE_SIZE, searchBeatmapsets, type DirectQuery, type DirectSet, type DirectSort, type DirectStatus, type MyKind } from '../project/direct';
import { projectFromLink } from '../project/open';
import { starColour } from './filter';

const STATUSES: [DirectStatus, string][] = [
  ['ranked', 'Ranked'],
  ['loved', 'Loved'],
  ['qualified', 'Qualified'],
  ['pending', 'Pending'],
  ['graveyard', 'Graveyard'],
  ['any', 'All'],
];
const MODES: [number | null, string][] = [
  [null, 'All'],
  [0, 'osu!'],
  [1, 'osu!taiko'],
  [2, 'osu!catch'],
  [3, 'osu!mania'],
];
const MY_KINDS: [MyKind | 'all', string][] = [
  ['all', 'My beatmaps'],
  ['pending', 'My WIP & pending'],
  ['ranked', 'My ranked'],
  ['loved', 'My loved'],
  ['guest', 'My guest difficulties'],
  ['graveyard', 'My graveyard'],
];
/** Stable's three sort tabs. New Releases sorts by ranked date where sets have one, else by submission. */
const TABS: { sort: DirectSort; label: string; className: string }[] = [
  { sort: 'ranked', label: 'New Releases', className: 'new' },
  { sort: 'favourites', label: 'Top Rated', className: 'top' },
  { sort: 'plays', label: 'Most Played', className: 'played' },
];
const DATED: DirectStatus[] = ['ranked', 'loved', 'qualified'];
/** Mode icons shown per difficulty before the rest are summed up as "+n". */
const MAX_ICONS = 12;

type Download = { progress: number; error?: string; projectId?: string };

interface Props {
  /** Beatmapset id → local project id, for sets already in song select. */
  have: Map<number, string>;
  onImported: (projectId: string) => Promise<void>;
  onOpen: (projectId: string) => void;
  onClose: () => void;
  /** Song select's background, shown dimmed behind the panel. */
  background?: string | null;
  /** Open on My beatmaps (needs the osu! login). */
  mine?: boolean;
}

function formatLength(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function formatCount(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);
}

function formatDate(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** The row's second line, like stable's "Ranked: 24/10/2026 16:05:03". */
function dateLine(s: DirectSet) {
  const label = { ranked: 'Ranked', approved: 'Approved', loved: 'Loved', qualified: 'Qualified' }[s.status];
  const line = label && s.ranked ? `${label}: ${formatDate(s.ranked)}` : s.updated ? `Last updated: ${formatDate(s.updated)}` : s.status;
  return s.kind === 'guest' ? `${line} (guest difficulty)` : line;
}

function ModeIcon({ mode }: { mode: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {mode === 1 ? (
        <>
          <ellipse cx="12" cy="11" rx="9" ry="3.5" />
          <path d="M3 11v5c0 1.9 4 3.5 9 3.5s9-1.6 9-3.5v-5M9 9.5 5 3M15 9.5l4-6.5" />
        </>
      ) : mode === 2 ? (
        <>
          <path d="M12 7.5c-2-1.6-6-1.4-7 2.2-1 3.6 1.4 9.3 4.4 9.8 1.2.2 1.8-.5 2.6-.5s1.4.7 2.6.5c3-.5 5.4-6.2 4.4-9.8-1-3.6-5-3.8-7-2.2Z" fill="currentColor" />
          <path d="M12 7.5c0-2 .8-3.5 2.5-4.5" />
        </>
      ) : mode === 3 ? (
        <>
          <rect x="3" y="4" width="18" height="16" rx="1.5" />
          <path d="M7.5 13v7M12 13v7M16.5 13v7" />
          <path d="M6.2 4h2.6v9H6.2zM10.7 4h2.6v9h-2.6zM15.2 4h2.6v9h-2.6z" fill="currentColor" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9.5" />
          <circle cx="12" cy="12" r="5" />
        </>
      )}
    </svg>
  );
}

function StatusIcon({ status }: { status: string }) {
  const icon =
    status === 'ranked' ? <path d="M6 12.5l6-6 6 6M6 18.5l6-6 6 6" />
    : status === 'approved' || status === 'qualified' ? <path d="M5 12.5l4.5 4.5L19 7.5" />
    : status === 'loved' ? <path d="M12 20s-8-4.6-8-10.2C4 6.9 6.1 5 8.4 5c1.6 0 2.8.8 3.6 2 .8-1.2 2-2 3.6-2C17.9 5 20 6.9 20 9.8 20 15.4 12 20 12 20Z" fill="currentColor" />
    : status === 'graveyard' ? <path d="M7 20V9.5a5 5 0 0 1 10 0V20ZM12 10v5M9.5 12.5h5M5 20h14" />
    : <path d="M9 9a3 3 0 1 1 4 2.8c-.7.3-1 .9-1 1.6V15M12 18.5v.5" />;
  return (
    <svg className={`dl-status ${status}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <title>{status}</title>
      {icon}
    </svg>
  );
}

export function DirectPanel({ have, background, onImported, onOpen, onClose, mine: startMine = false }: Props) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState<Omit<DirectQuery, 'offset'>>({ query: '', mode: 0, status: 'ranked', sort: 'plays' });
  const [results, setResults] = useState<DirectSet[]>([]);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState(startMine && !!cloud.user);
  const [myKind, setMyKind] = useState<MyKind | 'all'>('all');
  const [mySets, setMySets] = useState<DirectSet[] | null>(null);
  const [myError, setMyError] = useState<string | null>(null);
  const [showHave, setShowHave] = useState(false);
  const [picked, setPicked] = useState<DirectSet | null>(null);
  const [downloads, setDownloads] = useState<Map<number, Download>>(new Map());
  const [playing, setPlaying] = useState<number | null>(null);
  const [previewAt, setPreviewAt] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const request = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const state = useRef({ loading, more, results, query, mine, picked });
  state.current = { loading, more, results, query, mine, picked };

  const load = async (q: Omit<DirectQuery, 'offset'>, offset: number) => {
    request.current?.abort();
    const ctrl = new AbortController();
    request.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const sort = q.sort === 'ranked' && !DATED.includes(q.status) ? 'newest' : q.sort;
      const page = await searchBeatmapsets({ ...q, sort, offset }, ctrl.signal);
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
    if (mine) return;
    list.current?.scrollTo(0, 0);
    void load(query, 0);
  }, [query, mine]);
  useEffect(() => {
    if (text === query.query) return;
    const t = window.setTimeout(() => setQuery((q) => ({ ...q, query: text })), 350);
    return () => window.clearTimeout(t);
  }, [text]);

  // Next page when the end of the list is in view: on scrolling, and after a page whose sets were all hidden as
  // already downloaded.
  const loadMore = () => {
    const s = state.current;
    const end = sentinel.current?.getBoundingClientRect();
    const box = list.current?.getBoundingClientRect();
    if (!end || !box || end.top > box.bottom + 200) return;
    if (!s.mine && !s.loading && s.more && s.results.length) void load(s.query, s.results.length);
  };
  useEffect(loadMore, [results, loading, showHave]);

  useEffect(() => {
    music.pause();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (state.current.picked) setPicked(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      request.current?.abort();
      audio.current?.pause();
    };
  }, [onClose]);

  // My beatmaps loads once per panel; the list is filtered here rather than searched.
  useEffect(() => {
    if (!mine || mySets) return;
    const ctrl = new AbortController();
    setMyError(null);
    myBeatmapsets(ctrl.signal).then(
      (sets) => setMySets(sets.filter((x, i) => sets.findIndex((y) => y.id === x.id) === i)),
      (e) => !ctrl.signal.aborted && setMyError((e as Error).message),
    );
    return () => ctrl.abort();
  }, [mine, mySets]);

  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (
    !mine
      ? results
      : (mySets ?? []).filter((s) => {
          if (myKind !== 'all' && s.kind !== myKind) return false;
          if (query.mode !== null && !s.difficulties.some((x) => x.mode === query.mode)) return false;
          const hay = `${s.artist} ${s.title} ${s.creator} ${s.difficulties.map((x) => x.version).join(' ')}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        })
  ).filter((s) => showHave || !have.has(s.id));

  const stopPreview = () => {
    audio.current?.pause();
    setPlaying(null);
  };

  const startPreview = (s: DirectSet) => {
    audio.current ??= new Audio();
    const a = audio.current;
    music.pause();
    setPreviewAt(0);
    a.src = s.preview;
    a.volume = editor.prefs.masterVolume * editor.prefs.musicVolume;
    a.onended = () => setPlaying(null);
    a.ontimeupdate = () => a.duration && setPreviewAt(a.currentTime / a.duration);
    a.play().then(
      () => setPlaying(s.id),
      () => setPlaying(null),
    );
  };

  // Clicking a set opens it in the side panel and plays its preview, like stable; clicking it again stops the preview.
  const pick = (s: DirectSet) => {
    setPicked(s);
    if (playing === s.id) stopPreview();
    else startPreview(s);
  };

  const setDownload = (id: number, d: Download | null) =>
    setDownloads((m) => {
      const n = new Map(m);
      if (d) n.set(id, d);
      else n.delete(id);
      return n;
    });

  const download = async (id: number, label: string, video = editor.prefs.downloadVideo) => {
    if (downloads.get(id) && !downloads.get(id)!.error) return;
    setDownload(id, { progress: 0 });
    let last = 0;
    try {
      const p = await projectFromLink(String(id), (f) => {
        // Keep re-renders to a few per second.
        if (f - last < 0.02 && f < 1) return;
        last = f;
        setDownload(id, { progress: f });
      }, video);
      setDownload(id, { progress: 1, projectId: p.id });
      await onImported(p.id);
      editor.toast(`Downloaded ${label}.`);
    } catch (e) {
      setDownload(id, { progress: 0, error: (e as Error).message });
      editor.toast((e as Error).message, 'error');
    }
  };

  const localOf = (s: DirectSet) => downloads.get(s.id)?.projectId ?? have.get(s.id);
  const get = (s: DirectSet) => {
    const local = localOf(s);
    if (local) onOpen(local);
    else void download(s.id, `${s.artist} - ${s.title}`);
  };

  const display = mine ? `mine:${myKind}` : query.status;
  const count = mine
    ? myError ?? (mySets ? `${shown.length} beatmap${shown.length === 1 ? '' : 's'} found!` : 'Loading your beatmaps…')
    : error ?? (loading && !results.length ? 'Searching…' : `${shown.length}${more ? '+' : ''} matches found!`);

  const p = picked;
  const pd = p && downloads.get(p.id);
  const pLocal = p && localOf(p);
  const pLength = p ? Math.max(0, ...p.difficulties.map((x) => x.length)) : 0;

  return (
    <div className="dl" onDragOver={(e) => e.stopPropagation()}>
      {background && <img className="dl-bg" src={background} alt="" />}
      <div className="dl-head">
        <div className="dl-searchbox">
          <input
            autoFocus
            className="dl-search"
            placeholder={mine ? 'Filter by artist, title or difficulty name' : 'Search, or paste a beatmap link'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const link = /beatmapsets\/(\d+)/.exec(text);
                if (link) void download(Number(link[1]), `beatmapset ${link[1]}`);
                else if (!mine) setQuery((q) => ({ ...q, query: text }));
              }
            }}
          />
          <div className={`dl-count ${(mine ? myError : error) ? 'error' : ''}`}>{count}</div>
        </div>
        <div className="dl-tabs">
          {TABS.map((t) => (
            <button key={t.sort} className={`${t.className} ${!mine && query.sort === t.sort ? 'active' : ''}`} disabled={mine}
              onClick={() => setQuery((q) => ({ ...q, sort: t.sort }))}>{t.label}</button>
          ))}
        </div>
      </div>

      <div className="dl-main">
        <div className="dl-filters">
          <label>
            Display:
            <select className="dl-select" value={display} onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith('mine:')) {
                setMine(true);
                setMyKind(v.slice(5) as MyKind | 'all');
              } else {
                setMine(false);
                setQuery((q) => ({ ...q, status: v as DirectStatus }));
              }
            }}>
              {STATUSES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              {cloud.user && (
                <optgroup label={cloud.user.username}>
                  {MY_KINDS.map(([v, label]) => <option key={v} value={`mine:${v}`}>{label}</option>)}
                </optgroup>
              )}
            </select>
          </label>
          <label>
            Mode:
            <select className="dl-select mode" value={String(query.mode)} onChange={(e) => setQuery((q) => ({ ...q, mode: e.target.value === 'null' ? null : Number(e.target.value) }))}>
              {MODES.map(([v, label]) => <option key={label} value={String(v)}>{label}</option>)}
            </select>
          </label>
          <button className={`dl-check ${showHave ? 'on' : ''}`} onClick={() => setShowHave((v) => !v)}>
            <span />Show already downloaded maps
          </button>
        </div>

        <div className="dl-list" ref={list} onScroll={loadMore}>
          {shown.map((s) => {
            const d = downloads.get(s.id);
            const diffs = query.mode === null ? s.difficulties : s.difficulties.filter((x) => x.mode === query.mode);
            const bar = d && !d.error ? { width: d.progress, kind: 'download' } : playing === s.id ? { width: previewAt, kind: 'preview' } : null;
            return (
              <div key={s.id} className={`dl-row ${p?.id === s.id ? 'sel' : ''} ${localOf(s) ? 'have' : ''}`}
                onClick={() => pick(s)} onDoubleClick={() => get(s)}>
                <div className="dl-thumb" style={{ backgroundImage: `url("${s.thumb}")` }} />
                <div className="dl-line top">
                  <span className="dl-name">{s.artist} - {s.title}</span>
                  <span className="dl-mapper">{s.creator}</span>
                </div>
                <div className="dl-line">
                  <span className="dl-date">{d?.error ? `Download failed: ${d.error}` : dateLine(s)}</span>
                  <span className="dl-icons">
                    {diffs.slice(0, MAX_ICONS).map((x) => (
                      <span key={x.id} className="dl-mode" title={`${x.version} (${x.stars.toFixed(2)}★)`}><ModeIcon mode={x.mode} /></span>
                    ))}
                    {diffs.length > MAX_ICONS && <span className="dl-more">+{diffs.length - MAX_ICONS}</span>}
                    <StatusIcon status={s.status} />
                  </span>
                </div>
                <div className={`dl-bar ${bar?.kind ?? ''}`}><div style={{ width: `${(bar?.width ?? 0) * 100}%` }} /></div>
              </div>
            );
          })}
          <div ref={sentinel} className="dl-end">
            {mine
              ? mySets && shown.length === 0 && (mySets.length ? 'None of your beatmaps match.' : 'You haven’t uploaded any beatmaps yet.')
              : error ? error : loading ? 'Searching…' : shown.length === 0 ? 'No beatmaps found.' : more ? '' : 'That’s all of them.'}
          </div>
        </div>
      </div>

      <div className="dl-side">
        <div className="dl-side-title"><span>osu!direct</span><span>panel</span></div>
        {p && (
          <>
            <div className="dl-side-artist">{p.artist}</div>
            <div className="dl-side-name">{p.title}</div>
            <div className="dl-side-by">by {p.creator}</div>
            <div className="dl-side-image" style={{ backgroundImage: `url("${p.thumb.replace('/list.jpg', '/list@2x.jpg')}"), url("${p.thumb}")` }}
              onClick={() => (playing === p.id ? stopPreview() : startPreview(p))} title={playing === p.id ? 'Stop preview' : 'Play preview'} />
            <div className="dl-side-buttons">
              {pLocal ? (
                <button className="dl-btn download" onClick={() => onOpen(pLocal)}>Open</button>
              ) : pd && !pd.error ? (
                <button className="dl-btn download" disabled>{Math.round(pd.progress * 100)}%</button>
              ) : (
                <>
                  <button className="dl-btn download" onClick={() => void download(p.id, `${p.artist} - ${p.title}`)} title={pd?.error}>{pd?.error ? 'Retry' : 'Download'}</button>
                  {p.video && editor.prefs.downloadVideo && (
                    <button className="dl-btn novideo" onClick={() => void download(p.id, `${p.artist} - ${p.title}`, false)}>DL NoVideo</button>
                  )}
                </>
              )}
              <button className="dl-btn cancel" onClick={() => { setPicked(null); stopPreview(); }}>Cancel</button>
              {p.thread && <a className="dl-btn thread" href={p.thread} target="_blank" rel="noreferrer">View Thread</a>}
              <a className="dl-btn listing" href={`https://osu.ppy.sh/beatmapsets/${p.id}`} target="_blank" rel="noreferrer">View Listing</a>
            </div>
            <div className="dl-side-stats">
              {Math.round(p.bpm)} BPM · {formatLength(pLength)} · ▶ {formatCount(p.plays)} · ♥ {formatCount(p.favourites)}
              {p.video && ' · video'}
              {p.storyboard && ' · storyboard'}
            </div>
            <div className="dl-side-diffs">
              {p.difficulties.map((x) => (
                <div key={x.id} className="dl-side-diff">
                  <span className="dl-mode" style={{ color: starColour(x.stars) }}><ModeIcon mode={x.mode} /></span>
                  <span className="dl-side-version">{x.version}</span>
                  <span>{x.stars.toFixed(2)}★</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="dl-credit">
          {mine ? 'Your beatmaps from osu.ppy.sh' : 'Search by osu.direct'}, downloads from osu.direct / nerinyan.moe mirrors. Maps are saved in this browser.
        </div>
      </div>

      <button className="ss-back dl-back" onClick={onClose} title="Back (Esc)">
        <span className="ss-back-arrow">«</span> back
      </button>
    </div>
  );
}
