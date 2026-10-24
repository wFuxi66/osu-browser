import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useCloud } from '../App';
import { music } from '../audio/music';
import { editor, useEditor } from '../editor/store';
import { fmt, formatBpm, formatLength } from '../osu/info';
import { cloud } from '../project/cloud';
import { DRIVE_FOLDER } from '../project/drive';
import { mapStatus, onlineSet, statusLabel, type MapStatus } from '../project/online';
import { filesFromDrop, openNewBeatmap, pickFiles, projectFromFiles, projectFromLink, updateToLatest } from '../project/open';
import { downloadBlob, exportOsz, oszFilename } from '../project/project';
import { deleteDifficultyLocal, deleteProjectLocal, listProjectsLocal, loadProjectLocal, type DifficultySummary, type ProjectSummary } from '../project/storage';
import { layoutCode } from '../editor/shortcuts';
import { options, optionsOpen } from '../ui/options';
import { ask, promptOpen, type PromptButton } from '../ui/prompt';
import { DirectPanel } from './DirectPanel';
import { difficultyColour, GROUP_LABELS, groupOf, matches, parseSearch, SORT_LABELS, sortSets, type GroupMode, type SortMode } from './filter';

type Row =
  | { kind: 'group'; key: string; label: string; count: number; expanded: boolean }
  | { kind: 'set'; key: string; set: ProjectSummary; diffs: DifficultySummary[] }
  | { kind: 'diff'; key: string; set: ProjectSummary; diff: DifficultySummary };

interface Selection {
  setId: string;
  diffId: string;
}

const PREFS_KEY = 'osu-web-editor:songselect';
const TABS: GroupMode[] = ['artist', 'creator', 'date', 'mode', 'none'];

function loadUiPrefs(): { group: GroupMode; sort: SortMode } {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return { group: v.group in GROUP_LABELS ? v.group : 'none', sort: v.sort in SORT_LABELS ? v.sort : 'date' };
  } catch {
    return { group: 'none', sort: 'date' };
  }
}

/** How long song select takes to fade out into the editor (ms). */
const LEAVE_MS = 260;

const urlCache = new WeakMap<Blob, string>();
function blobUrl(b: Blob | null): string | null {
  if (!b) return null;
  let u = urlCache.get(b);
  if (!u) {
    u = URL.createObjectURL(b);
    urlCache.set(b, u);
  }
  return u;
}

/** Edit-mode song select: every local (and synced) beatmap in a stable-style carousel. */
export function SongSelect() {
  useEditor();
  const userKey = useCloud();
  const [sets, setSets] = useState<ProjectSummary[] | null>(null);
  const [search, setSearch] = useState('');
  const [{ group, sort }, setUi] = useState(loadUiPrefs);
  const [sel, setSel] = useState<Selection | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [direct, setDirect] = useState<null | 'search' | 'mine'>(null);
  const directOpen = direct !== null;
  const closeDirect = useCallback(() => setDirect(null), []);
  const haveSets = useMemo(() => new Map((sets ?? []).filter((s) => s.beatmapSetId > 0).map((s) => [s.beatmapSetId, s.id])), [sets]);
  const randomHistory = useRef<Selection[]>([]);

  const refresh = useCallback(async () => {
    const list = await listProjectsLocal().catch(() => [] as ProjectSummary[]);
    setSets(list);
    return list;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ group, sort }));
    } catch {
      /* storage unavailable */
    }
  }, [group, sort]);

  // Two-way sync with Google Drive whenever we arrive here with it connected.
  useEffect(() => {
    const result = cloud.driveResult;
    cloud.driveResult = null;
    if (result === 'connected') editor.toast(`Google Drive connected. Your maps sync to the "${DRIVE_FOLDER}" folder in your Drive.`);
    else if (result === 'noscope') editor.toast('Google Drive wasn\x27t connected: allow access to the files this editor creates, then try again.', 'error');
    else if (result === 'cancelled') editor.toast('Google Drive wasn\x27t connected.');
    if (!cloud.syncing) return;
    void editor.syncSettings();
    setBusy('Syncing with Google Drive…');
    cloud
      .syncAll()
      .then((n) => n > 0 && editor.toast(`Synced ${n} beatmap${n > 1 ? 's' : ''} with Google Drive.`))
      .catch((e) => editor.toast(`Sync failed: ${e.message}`, 'error'))
      .finally(() => {
        setBusy(null);
        void refresh();
      });
  }, [userKey, refresh]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      editor.toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  // The status box's "Update to latest version", with stable's warning.
  const updateSet = async (set: ProjectSummary, diff: DifficultySummary) => {
    const r = await ask({
      look: 'game',
      title: 'Retrieving the latest version will destroy ALL local changes to this beatmap.  Are you sure you want to do this?',
      buttons: [
        { label: 'Yes, discard my local changes!', value: 'yes', tone: 'red' },
        { label: 'Nooo, I need those!', value: 'no', tone: 'grey' },
      ],
      cancelValue: 'no',
    });
    if (r !== 'yes') return;
    await run('Downloading the latest version…', async () => {
      const p = await updateToLatest(set.id, set.beatmapSetId);
      if (cloud.syncing) await cloud.upload(p).catch((e) => editor.toast(`Cloud sync failed: ${e.message}`, 'error'));
      await refresh();
      const same =
        p.difficulties.find((d) => diff.beatmapId > 0 && d.beatmap.metadata.beatmapId === diff.beatmapId) ??
        p.difficulties.find((d) => d.beatmap.metadata.version === diff.version) ??
        p.difficulties[0];
      setSel({ setId: p.id, diffId: same.id });
      editor.toast('Updated to the latest version.');
    });
  };

  // ------------------------------------------------------------------ rows
  const parsed = useMemo(() => parseSearch(search), [search]);
  const visible = useMemo(() => {
    if (!sets) return [];
    return sortSets(sets, sort)
      .map((s) => ({ set: s, diffs: s.difficulties.filter((d) => matches(s, d, parsed)) }))
      .filter((x) => x.diffs.length > 0);
  }, [sets, sort, parsed]);

  // Keep the selection valid: last opened map, else the first one.
  useEffect(() => {
    if (!visible.length) return;
    const has = (s: Selection | null) => !!s && visible.some((v) => v.set.id === s.setId && v.diffs.some((d) => d.id === s.diffId));
    if (has(sel)) return;
    const last = editor.lastOpened;
    if (last && has({ setId: last.projectId, diffId: last.diffId })) setSel({ setId: last.projectId, diffId: last.diffId });
    else if (sel && visible.some((v) => v.set.id === sel.setId)) {
      const v = visible.find((x) => x.set.id === sel.setId)!;
      setSel({ setId: v.set.id, diffId: v.diffs[0].id });
    } else setSel({ setId: visible[0].set.id, diffId: visible[0].diffs[0].id });
  }, [visible, sel]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const pushSet = (v: { set: ProjectSummary; diffs: DifficultySummary[] }) => {
      if (sel?.setId === v.set.id) for (const d of v.diffs) out.push({ kind: 'diff', key: `d-${d.id}`, set: v.set, diff: d });
      else out.push({ kind: 'set', key: `s-${v.set.id}`, set: v.set, diffs: v.diffs });
    };
    if (group === 'none') {
      visible.forEach(pushSet);
      return out;
    }
    const groups = new Map<string, { order: number | string; items: typeof visible }>();
    for (const v of visible) {
      const g = groupOf(v.set, group);
      if (!groups.has(g.key)) groups.set(g.key, { order: g.order, items: [] });
      groups.get(g.key)!.items.push(v);
    }
    const ordered = [...groups.entries()].sort((a, b) => (a[1].order < b[1].order ? -1 : a[1].order > b[1].order ? 1 : 0));
    for (const [key, g] of ordered) {
      const containsSel = g.items.some((v) => v.set.id === sel?.setId);
      const expanded = expandedGroups.has(key) || containsSel;
      out.push({ kind: 'group', key: `g-${key}`, label: key, count: g.items.length, expanded });
      if (expanded) g.items.forEach(pushSet);
    }
    return out;
  }, [visible, group, sel?.setId, expandedGroups]);

  const selSet = sets?.find((s) => s.id === sel?.setId) ?? null;
  const selDiff = selSet?.difficulties.find((d) => d.id === sel?.diffId) ?? null;

  // ------------------------------------------------------------------ preview music
  useEffect(() => {
    if (!selSet?.audio || directOpen) {
      music.pause();
      return;
    }
    let cancelled = false;
    const preview = () => {
      const p = selSet.difficulties[0]?.previewTime ?? -1;
      return p >= 0 ? p : (music.duration || 0) * 0.4;
    };
    // Back from the editor, the song starts over from the beginning; otherwise from the preview point. Either way it
    // fades in, at full speed whatever the editor's playback rate was.
    const back = editor.returnedFrom === selSet.id;
    editor.returnedFrom = null;
    const start = async () => {
      if (music.blob !== selSet.audio) await music.load(selSet.audio);
      if (cancelled) return;
      music.rate = 1;
      music.seek(back ? 0 : preview());
      music.fadeIn(back ? 1200 : 600);
      await music.play();
    };
    void start();
    // Loop from the preview point when the song ends, like stable.
    const off = music.onChange(() => {
      if (!cancelled && !music.playing && music.duration && music.time >= music.duration - 30) {
        music.seek(preview());
        void music.play();
      }
    });
    // Browsers block autoplay until the first click/key; start then.
    const kick = () => !cancelled && !music.playing && music.blob === selSet.audio && void music.play();
    window.addEventListener('pointerdown', kick, { once: true });
    window.addEventListener('keydown', kick, { once: true });
    return () => {
      cancelled = true;
      off();
      window.removeEventListener('pointerdown', kick);
      window.removeEventListener('keydown', kick);
    };
  }, [selSet?.id, selSet?.audio, directOpen]);

  useEffect(() => () => music.pause(), []);

  // ------------------------------------------------------------------ actions
  // Into the editor: song select and its music fade out while the map loads, then the editor fades in.
  const openEditor = useCallback(
    async (s: Selection | null = sel) => {
      if (!s || leaving) return;
      setLeaving(true);
      music.fadeOut(LEAVE_MS);
      try {
        const [p] = await Promise.all([loadProjectLocal(s.setId), new Promise((r) => setTimeout(r, LEAVE_MS))]);
        if (!p) throw new Error('That beatmap is no longer stored in this browser.');
        await editor.openProject(p, Math.max(0, p.difficulties.findIndex((d) => d.id === s.diffId)));
      } catch (e) {
        editor.toast((e as Error).message, 'error');
        setLeaving(false);
        music.fadeIn(300);
      }
    },
    [sel, leaving],
  );

  const selectImported = async (projectId: string) => {
    const list = await refresh();
    const s = list.find((x) => x.id === projectId);
    if (s) setSel({ setId: s.id, diffId: s.difficulties[0].id });
    setSearch('');
  };

  const handleFiles = (files: File[]) =>
    run('Opening…', async () => {
      const r = await projectFromFiles(files);
      if (r.kind === 'created') await openNewBeatmap(r.project);
      else {
        await selectImported(r.project.id);
        editor.toast(`Imported ${r.project.difficulties.length} difficult${r.project.difficulties.length > 1 ? 'ies' : 'y'}.`);
      }
    });

  const openLink = (link: string) =>
    run('Downloading beatmap…', async () => {
      const p = await projectFromLink(link, undefined, editor.prefs.downloadVideo);
      setLinkOpen(false);
      await selectImported(p.id);
    });

  const deleteDialog = async () => {
    if (!selSet || !selDiff) return;
    const many = selSet.difficulties.length > 1;
    const r = await ask({
      look: 'game',
      title: 'Confirm deletion',
      message: `${selSet.artist} - ${selSet.songTitle} [${selDiff.version}]`,
      buttons: [
        ...(many ? [{ label: `Delete only [${selDiff.version}]`, value: 'diff', tone: 'pink' as const }] : []),
        { label: many ? 'Delete ALL difficulties in this beatmap set' : 'Delete this beatmap', value: 'set', tone: 'red' },
        { label: 'Cancel', value: 'cancel', tone: 'grey' },
      ],
      cancelValue: 'cancel',
    });
    if (r === 'cancel') return;
    await run('Deleting…', async () => {
      if (r === 'diff') {
        const p = await deleteDifficultyLocal(selSet.id, selDiff.id);
        if (p && cloud.syncing) await cloud.upload(p).catch((e) => editor.toast(`Cloud sync failed: ${e.message}`, 'error'));
      } else {
        await deleteProjectLocal(selSet.id);
        if (cloud.syncing) await cloud.remove(selSet.id);
      }
      await refresh();
    });
  };

  const optionsDialog = async () => {
    if (!selSet || !selDiff) return;
    const r = await ask({
      look: 'game',
      title: `${selSet.artist} - ${selSet.songTitle} [${selDiff.version}]`,
      message: 'Beatmap options',
      buttons: [
        { label: 'Edit', value: 'edit', tone: 'pink' },
        { label: 'Export package (.osz)', value: 'export', tone: 'blue' },
        { label: 'Delete...', value: 'delete', tone: 'red' },
        { label: 'Close', value: 'close', tone: 'grey' },
      ],
      cancelValue: 'close',
    });
    if (r === 'edit') void openEditor();
    else if (r === 'delete') void deleteDialog();
    else if (r === 'export')
      void run('Exporting…', async () => {
        const p = await loadProjectLocal(selSet.id);
        if (p) downloadBlob(await exportOsz(p), oszFilename(p));
      });
  };

  // ------------------------------------------------------------------ keyboard navigation
  const flatDiffs = useMemo(() => visible.flatMap((v) => v.diffs.map((d) => ({ setId: v.set.id, diffId: d.id }))), [visible]);

  const moveDiff = (dir: 1 | -1) => {
    if (!flatDiffs.length) return;
    const i = flatDiffs.findIndex((x) => x.setId === sel?.setId && x.diffId === sel?.diffId);
    setSel(flatDiffs[Math.max(0, Math.min(flatDiffs.length - 1, i + dir))]);
  };
  const moveSet = (dir: 1 | -1) => {
    if (!visible.length) return;
    const i = visible.findIndex((v) => v.set.id === sel?.setId);
    const v = visible[Math.max(0, Math.min(visible.length - 1, i + dir))];
    setSel({ setId: v.set.id, diffId: v.diffs[0].id });
  };
  const moveGroup = (dir: 1 | -1) => {
    if (group === 'none') return moveSet(dir);
    const keys = visible.map((v) => groupOf(v.set, group).key);
    const i = visible.findIndex((v) => v.set.id === sel?.setId);
    let j = i;
    while (j + dir >= 0 && j + dir < visible.length && keys[j + dir] === keys[i]) j += dir;
    j = Math.max(0, Math.min(visible.length - 1, j + dir));
    setSel({ setId: visible[j].set.id, diffId: visible[j].diffs[0].id });
  };
  const random = () => {
    if (visible.length < 2) return;
    if (sel) randomHistory.current.push(sel);
    let v;
    do v = visible[Math.floor(Math.random() * visible.length)];
    while (v.set.id === sel?.setId);
    setSel({ setId: v.set.id, diffId: v.diffs[Math.floor(Math.random() * v.diffs.length)].id });
  };

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyHandler.current = (e: KeyboardEvent) => {
    if (promptOpen() || optionsOpen() || busy || leaving || directOpen) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && layoutCode(e) === 'KeyO') {
      e.preventDefault();
      options.show();
      return;
    }
    let handled = true;
    switch (e.key) {
      case 'ArrowDown': moveDiff(1); break;
      case 'ArrowUp': moveDiff(-1); break;
      case 'ArrowRight': e.shiftKey ? moveGroup(1) : moveSet(1); break;
      case 'ArrowLeft': e.shiftKey ? moveGroup(-1) : moveSet(-1); break;
      case 'Enter': void openEditor(); break;
      case 'F2': if (e.shiftKey) { const prev = randomHistory.current.pop(); if (prev) setSel(prev); } else random(); break;
      case 'F3': void optionsDialog(); break;
      case 'Delete': if (e.shiftKey) void deleteDialog(); else handled = false; break;
      case 'Escape': if (linkOpen) setLinkOpen(false); else if (search) setSearch(''); break;
      case 'Backspace':
        if (e.ctrlKey) setSearch((s) => s.replace(/\S*\s*$/, ''));
        else setSearch((s) => s.slice(0, -1));
        break;
      case 'PageDown': carousel.current?.page(1); break;
      case 'PageUp': carousel.current?.page(-1); break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) setSearch((s) => s + e.key);
        else handled = false;
    }
    if (handled) e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const carousel = useRef<{ page: (dir: 1 | -1) => void } | null>(null);
  const bg = blobUrl(selSet?.background ?? null);

  return (
    <div
      className={`ss ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(await filesFromDrop(e.dataTransfer));
      }}
    >
      <div className="ss-bg">{bg && <img key={bg} src={bg} alt="" />}</div>

      <Carousel ref={carousel} rows={rows} sel={sel} onSelect={setSel} onOpen={(s) => void openEditor(s)} onOptions={optionsDialog}
        onToggleGroup={(key) => setExpandedGroups((g) => { const n = new Set(g); if (n.has(key)) n.delete(key); else n.add(key); return n; })} />

      <header className="ss-header">
        <svg className="ss-header-shape" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden>
          <path d="M0 0 H1000 V52 H330 C305 52 300 98 270 98 H0 Z" />
          <path className="edge" d="M1000 52 H330 C305 52 300 98 270 98 H0" />
        </svg>
        <BeatmapInfoPanel set={selSet} diff={selDiff} />
        <div className="ss-controls">
          <div className="ss-dropdowns">
            <label><span className="ss-dd-label">Group</span>
              <select value={group} onChange={(e) => setUi((u) => ({ ...u, group: e.target.value as GroupMode }))}>
                {Object.entries(GROUP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label><span className="ss-dd-label">Sort</span>
              <select value={sort} onChange={(e) => setUi((u) => ({ ...u, sort: e.target.value as SortMode }))}>
                {Object.entries(SORT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
          <div className="ss-tabs">
            {TABS.map((t) => (
              <button key={t} className={group === t ? 'active' : ''} onClick={() => setUi((u) => ({ ...u, group: t }))}>{GROUP_LABELS[t]}</button>
            ))}
          </div>
        </div>
      </header>

      <div className="ss-search">
        <span className="ss-search-label">Search:</span> {search ? <span className="ss-search-text">{search}</span> : <span>Type to search!</span>}
        {search && <span className="ss-search-count">{visible.reduce((n, v) => n + v.diffs.length, 0)} matches</span>}
      </div>

      <div className="ss-left">
        <SubmissionStatus set={selSet} diff={selDiff} onUpdate={() => selSet && selDiff && void updateSet(selSet, selDiff)} />
        <button className="ss-drop" onClick={async () => { const f = await pickFiles('audio/*,.mp3,.ogg'); if (f.length) handleFiles(f); }}>
          <span><span>Drop an <b>mp3</b> file here<br />to start mapping</span></span>
        </button>
        <button className="ss-wide" onClick={async () => { const f = await pickFiles('.osz,.zip'); if (f.length) handleFiles(f); }}>
          Open an <b>.osz</b> file
        </button>
        <button className="ss-wide" onClick={async () => { const f = await pickFiles('', { directory: true }); if (f.length) handleFiles(f); }}>
          Open a <b>beatmap folder</b>
        </button>
        <button className="ss-wide" onClick={() => setDirect('search')}>
          <b>Search &amp; download</b> beatmaps
        </button>
        {linkOpen ? (
          <LinkInput onOpen={openLink} onCancel={() => setLinkOpen(false)} />
        ) : (
          <button className="ss-wide" onClick={() => setLinkOpen(true)}>Open a beatmap from <b>osu.ppy.sh</b></button>
        )}
      </div>

      <footer className="ss-footer">
        <button className="ss-back" onClick={() => (linkOpen ? setLinkOpen(false) : setSearch(''))} title="Back (Esc)">
          <span className="ss-back-arrow">«</span> back
        </button>
        <button className="ss-footer-btn ss-settings" onClick={() => options.show()} title="Options (Ctrl+O)" aria-label="Options">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
        </button>
        <button className="ss-footer-btn" onClick={random} title="Random (F2)">Random</button>
        <UserPanel onMyBeatmaps={() => setDirect('mine')} />
        <button className="ss-cookie" onClick={() => void openEditor()} disabled={!selDiff} title="Edit (Enter)">
          <span>edit</span>
        </button>
      </footer>

      {directOpen && (
        <DirectPanel
          mine={direct === 'mine'}
          background={bg}
          have={haveSets}
          onImported={async (id) => {
            const list = await refresh();
            const s = list.find((x) => x.id === id);
            if (s) setSel({ setId: s.id, diffId: s.difficulties[0].id });
          }}
          onOpen={(id) => {
            setDirect(null);
            void selectImported(id);
          }}
          onClose={closeDirect}
        />
      )}

      {sets && sets.length === 0 && (
        <div className="ss-empty">
          <div className="ss-empty-title">No beatmaps yet!</div>
          <div>Drop an mp3 to start mapping, open an .osz, or search &amp; download beatmaps.</div>
        </div>
      )}
      {sets && sets.length > 0 && visible.length === 0 && <div className="ss-empty"><div className="ss-empty-title">No matches for “{search}”</div><div>Press Esc to clear the search.</div></div>}
      {busy && <div className="busy">{busy}</div>}
      {leaving && <div className="ss-leave" />}
    </div>
  );
}

function BeatmapInfoPanel({ set, diff }: { set: ProjectSummary | null; diff: DifficultySummary | null }) {
  if (!set || !diff) return <div className="ss-info" />;
  const objects = diff.circles + diff.sliders + diff.spinners;
  const stats =
    diff.mode === 3
      ? `Keys:${fmt(diff.cs, 0)} OD:${fmt(diff.od)} HP:${fmt(diff.hp)}`
      : diff.mode === 1
        ? `OD:${fmt(diff.od)} HP:${fmt(diff.hp)}`
        : `CS:${fmt(diff.cs)} AR:${fmt(diff.ar)} OD:${fmt(diff.od)} HP:${fmt(diff.hp)}`;
  return (
    <div className="ss-info">
      <div className="ss-info-title">{set.artist} - {set.songTitle} [{diff.version}]</div>
      <div className="ss-info-mapper">Mapped by {set.creator || 'Unknown'}</div>
      <div className="ss-info-line"><b>Length:</b> {formatLength(diff.length)} <b>BPM:</b> {formatBpm(diff)} <b>Objects:</b> {objects}</div>
      <div className="ss-info-line">
        {diff.mode === 3 ? <><b>Notes:</b> {diff.circles} <b>Long notes:</b> {diff.sliders}</> : <><b>Circles:</b> {diff.circles} <b>Sliders:</b> {diff.sliders} <b>Spinners:</b> {diff.spinners}</>}
      </div>
      <div className="ss-info-stats">{stats}{diff.stars !== null && <> Star Rating: {fmt(diff.stars, 2)}★</>}</div>
    </div>
  );
}

const STATUS_ICONS = {
  heart: <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.9 4.5 6.6 4.5c2.2 0 3.7 1.3 4.4 2.6h2c.7-1.3 2.2-2.6 4.4-2.6 3.7 0 5.7 3.9 4.2 7.3C19.5 16.4 12 21 12 21z" fill="currentColor" />,
  check: <path d="M3.5 12.5l5.5 5.5L20.5 6.5" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />,
  cross: <path d="M5 5l14 14M19 5L5 19" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />,
  update: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M20.5 2.5v6.5H14z" fill="currentColor" />
    </>
  ),
};

/** Stable's status box: whether the selected difficulty is the version on osu!, an older or edited one, or unsubmitted. */
function SubmissionStatus({ set, diff, onUpdate }: { set: ProjectSummary | null; diff: DifficultySummary | null; onUpdate: () => void }) {
  const [status, setStatus] = useState<MapStatus | null>(null);
  const setId = set?.beatmapSetId ?? 0;
  const checksum = diff?.checksum ?? '';
  const beatmapId = diff?.beatmapId ?? 0;
  useEffect(() => {
    setStatus(null);
    if (!checksum) return;
    if (!(setId > 0)) {
      setStatus({ kind: 'unsubmitted' });
      return;
    }
    let live = true;
    onlineSet(setId).then(
      (s) => live && setStatus(mapStatus(checksum, beatmapId, s)),
      () => {}, // offline: show nothing rather than guess
    );
    return () => {
      live = false;
    };
  }, [setId, checksum, beatmapId]);

  // Keep the box's space while loading so the buttons below don't jump.
  if (!status) return <div className="ss-status ss-status-empty" />;
  let icon: keyof typeof STATUS_ICONS, text: string, tone: string;
  if (status.kind === 'unsubmitted') [icon, text, tone] = ['cross', 'Not submitted', 'unsubmitted'];
  else if (status.kind === 'update') [icon, text, tone] = ['update', 'Update to latest version', 'update'];
  else {
    const ranked = ['ranked', 'approved', 'qualified'].includes(status.status);
    const loved = status.status === 'loved';
    [icon, text, tone] = [ranked || loved ? 'heart' : 'check', statusLabel(status.status), loved ? 'loved' : ranked ? 'ranked' : 'pending'];
  }
  const page = `https://osu.ppy.sh/beatmapsets/${setId}${diff?.beatmapId ? `#${['osu', 'taiko', 'fruits', 'mania'][diff.mode]}/${diff.beatmapId}` : ''}`;
  return (
    <button
      className={`ss-status ${tone}`}
      disabled={status.kind === 'unsubmitted'}
      title={status.kind === 'update' ? 'Replace this beatmap set with the version on osu!' : status.kind === 'latest' ? 'Open the beatmap page on osu.ppy.sh' : undefined}
      onClick={() => (status.kind === 'update' ? onUpdate() : window.open(page, '_blank', 'noopener'))}
    >
      <svg className="ss-status-icon" viewBox="0 0 24 24" aria-hidden="true">
        {STATUS_ICONS[icon]}
      </svg>
      <span>{text}</span>
    </button>
  );
}

function LinkInput({ onOpen, onCancel }: { onOpen: (link: string) => void; onCancel: () => void }) {
  const [v, setV] = useState('');
  return (
    <div className="ss-link">
      <input
        autoFocus
        placeholder="osu.ppy.sh/beatmapsets/… or set id"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && v.trim()) onOpen(v);
          else if (e.key === 'Escape') onCancel();
          e.stopPropagation();
        }}
      />
      <button onClick={() => v.trim() && onOpen(v)}>Open</button>
    </div>
  );
}

/** The account dialog: Google Drive sync and the (optional) osu! login. */
async function accountDialog(onMyBeatmaps: () => void) {
  const u = cloud.user;
  const buttons: PromptButton[] = [];
  if (cloud.driveConfigured) {
    buttons.push(
      cloud.syncing
        ? { label: 'Stop syncing with Google Drive', value: 'drive-off', tone: 'pink' }
        : { label: 'Sync my maps with Google Drive', value: 'drive-on', tone: 'blue' },
    );
  }
  if (u) buttons.push({ label: 'My beatmaps on osu!', value: 'mine', tone: 'blue' }, { label: 'Log out of osu!', value: 'logout', tone: 'pink' });
  else if (cloud.oauthConfigured) buttons.push({ label: 'Log in with osu!', value: 'login', tone: 'pink' });
  buttons.push({ label: 'Privacy policy', value: 'privacy', tone: 'grey' }, { label: 'Close', value: 'close', tone: 'grey' });
  const drive = cloud.syncing
    ? `Your maps are saved in this browser and synced to the "${DRIVE_FOLDER}" folder in your Google Drive, so they're there on any computer.`
    : `Your maps are saved in this browser. Sync them with your Google Drive to open them on any computer: they go in a "${DRIVE_FOLDER}" folder, and the editor can only see the files it creates.`;
  const osu = u ? `Logged in to osu! as ${u.username}.` : cloud.oauthConfigured ? 'Log in with osu! to sign new maps with your name and open the maps you uploaded.' : '';
  const r = await ask({ look: 'game', title: u?.username ?? 'Your maps', message: [drive, osu].filter(Boolean).join(' '), buttons, cancelValue: 'close' });
  if (r === 'drive-on') cloud.connectDrive();
  else if (r === 'drive-off') {
    await cloud.disconnectDrive();
    editor.toast('Stopped syncing with Google Drive. The maps already there stay in your Drive.');
  } else if (r === 'login') cloud.login();
  else if (r === 'mine') onMyBeatmaps();
  else if (r === 'logout') await cloud.logout();
  else if (r === 'privacy') window.open('/privacy.html', '_blank', 'noopener');
}

function UserPanel({ onMyBeatmaps }: { onMyBeatmaps: () => void }) {
  useCloud();
  const u = cloud.user;
  const label = !cloud.available ? 'Offline' : u ? u.username : 'Guest';
  const canOpen = cloud.available && (cloud.driveConfigured || cloud.oauthConfigured || !!u);
  const sub = !cloud.available
    ? 'Maps are saved in this browser'
    : cloud.syncing
      ? 'Maps sync to Google Drive'
      : cloud.driveConfigured
        ? 'Click to sync your maps!'
        : cloud.oauthConfigured && !u
          ? 'Click to sign in!'
          : 'Maps are saved in this browser';
  return (
    <button className="ss-user" onClick={() => void accountDialog(onMyBeatmaps)} disabled={!canOpen}>
      <span className="ss-user-avatar">{u?.avatarUrl ? <img src={u.avatarUrl} alt="" /> : <span>?</span>}</span>
      <span className="ss-user-text">
        <span className="ss-user-name">{label}</span>
        <span className="ss-user-sub">{sub}</span>
      </span>
    </button>
  );
}

// ------------------------------------------------------------------ carousel

interface CarouselProps {
  rows: Row[];
  sel: Selection | null;
  onSelect: (s: Selection) => void;
  onOpen: (s: Selection) => void;
  onOptions: () => void;
  onToggleGroup: (key: string) => void;
}


const Carousel = forwardRef<{ page: (dir: 1 | -1) => void }, CarouselProps>(function Carousel({ rows, sel, onSelect, onOpen, onOptions, onToggleGroup }, ref) {
  const wrap = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLDivElement>());
  const scroll = useRef({ pos: 0, target: 0, init: false });
  const rightDrag = useRef(false);
  const hovered = useRef<string | null>(null);

  // Row geometry in px; scales with the window height like stable (768 "osu!pixel" tall screen).
  const layout = () => {
    const h = wrap.current?.clientHeight ?? window.innerHeight;
    const u = window.innerHeight / 768;
    let y = 0;
    const tops: number[] = [];
    const heights: number[] = [];
    for (const r of rows) {
      const rh = (r.kind === 'group' ? 42 : 74) * u;
      tops.push(y);
      heights.push(rh);
      y += rh + 4 * u;
    }
    return { h, u, tops, heights, total: y };
  };

  const selIndex = rows.findIndex((r) => r.kind === 'diff' && r.diff.id === sel?.diffId && r.set.id === sel?.setId);

  const centreOn = (i: number, instant = false) => {
    const L = layout();
    if (i < 0) return;
    scroll.current.target = L.tops[i] + L.heights[i] / 2 - L.h / 2;
    if (instant) scroll.current.pos = scroll.current.target;
  };

  useEffect(() => {
    centreOn(selIndex, !scroll.current.init);
    scroll.current.init = true;
  }, [selIndex, rows]);

  useImperativeHandle(ref, () => ({
    page: (dir) => {
      scroll.current.target += dir * (wrap.current?.clientHeight ?? 600) * 0.8;
    },
  }));

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const L = layout();
      const s = scroll.current;
      const min = -L.h / 2 + (L.heights[0] ?? 0) / 2;
      const max = L.total - L.h / 2 - (L.heights[L.heights.length - 1] ?? 0) / 2;
      s.target = Math.max(min, Math.min(Math.max(min, max), s.target));
      s.pos += (s.target - s.pos) * Math.min(1, dt * 9);
      const w = wrap.current?.clientWidth ?? window.innerWidth;
      rows.forEach((r, i) => {
        const el = els.current.get(r.key);
        if (!el) return;
        const top = L.tops[i] - s.pos;
        if (top > L.h + 200 || top + L.heights[i] < -200) {
          el.style.visibility = 'hidden';
          return;
        }
        el.style.visibility = '';
        // Panels sit on an arc: further from the middle of the screen, further right.
        const d = Math.abs((top + L.heights[i] / 2 - L.h / 2) / L.h);
        let x = w * (0.585 + 0.13 * d * d * 1.6);
        if (r.kind === 'diff') x -= w * (r.diff.id === sel?.diffId ? 0.06 : 0.025);
        if (r.kind === 'group') x += w * 0.02;
        if (hovered.current === r.key) x -= w * 0.012;
        el.style.transform = `translate(${x.toFixed(1)}px, ${top.toFixed(1)}px)`;
        el.style.height = `${L.heights[i]}px`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rows, sel?.diffId]);

  const absoluteScroll = (clientY: number) => {
    const L = layout();
    const r = wrap.current!.getBoundingClientRect();
    scroll.current.target = ((clientY - r.top) / r.height) * L.total - L.h / 2;
  };

  return (
    <div
      className="ss-carousel"
      ref={wrap}
      onWheel={(e) => (scroll.current.target += e.deltaY * (e.deltaMode === 1 ? 30 : 1))}
      onPointerDown={(e) => {
        if (e.button === 2 && !(e.target as HTMLElement).closest('.ss-panel')) {
          rightDrag.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          absoluteScroll(e.clientY);
        }
      }}
      onPointerMove={(e) => rightDrag.current && absoluteScroll(e.clientY)}
      onPointerUp={() => (rightDrag.current = false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {rows.map((r) => (
        <div
          key={r.key}
          ref={(el) => {
            if (el) els.current.set(r.key, el);
            else els.current.delete(r.key);
          }}
          className={`ss-panel ${r.kind} ${r.kind === 'diff' && r.diff.id === sel?.diffId ? 'selected' : ''} ${r.kind === 'group' && r.expanded ? 'expanded' : ''}`}
          onPointerEnter={() => (hovered.current = r.key)}
          onPointerLeave={() => hovered.current === r.key && (hovered.current = null)}
          onClick={() => {
            if (r.kind === 'group') onToggleGroup(r.label);
            else if (r.kind === 'set') onSelect({ setId: r.set.id, diffId: r.diffs[0].id });
            else if (r.diff.id === sel?.diffId) onOpen({ setId: r.set.id, diffId: r.diff.id });
            else onSelect({ setId: r.set.id, diffId: r.diff.id });
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (r.kind === 'group') return;
            const s = { setId: r.set.id, diffId: r.kind === 'diff' ? r.diff.id : r.diffs[0].id };
            onSelect(s);
            setTimeout(onOptions, 0);
          }}
        >
          {r.kind === 'group' ? (
            <div className="ss-group-label">{r.label} <span>({r.count})</span></div>
          ) : (
            <PanelBody set={r.set} diff={r.kind === 'diff' ? r.diff : null} diffs={r.kind === 'set' ? r.diffs : [r.diff]} />
          )}
        </div>
      ))}
    </div>
  );
});

function PanelBody({ set, diff, diffs }: { set: ProjectSummary; diff: DifficultySummary | null; diffs: DifficultySummary[] }) {
  const thumb = blobUrl(set.background);
  return (
    <>
      <div className="ss-thumb">{thumb && <img src={thumb} alt="" loading="lazy" />}</div>
      <div className="ss-panel-text">
        <div className="ss-panel-title">{set.songTitle || 'Untitled'}</div>
        <div className="ss-panel-artist">{set.artist || 'Unknown artist'} // {set.creator || 'Unknown'}</div>
        {diff ? (
          <>
            <div className="ss-panel-version">{diff.version}</div>
            <Stars diff={diff} />
          </>
        ) : (
          <div className="ss-panel-diffs">
            {diffs.slice(0, 18).map((d) => <span key={d.id} className="ss-diff-icon" style={{ background: difficultyColour(d) }} title={d.version} />)}
          </div>
        )}
      </div>
    </>
  );
}

function Stars({ diff }: { diff: DifficultySummary }) {
  if (diff.stars === null) return <div className="ss-stars" />;
  const full = Math.min(10, Math.floor(diff.stars));
  const part = Math.min(1, diff.stars - full);
  return (
    <div className="ss-stars" title={`${fmt(diff.stars, 2)} stars`}>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={`ss-star ${i < full ? 'on' : ''}`} style={i === full ? { transform: `scale(${0.4 + part * 0.6})`, opacity: 0.5 + part * 0.5 } : undefined} />
      ))}
    </div>
  );
}
