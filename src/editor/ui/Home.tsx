import { useCallback, useEffect, useRef, useState } from 'react';
import { useCloud } from '../../App';
import { cloud } from '../../project/cloud';
import {
  createProjectFromAudio,
  downloadBlob,
  exportOsz,
  importLooseFiles,
  importOsz,
  oszFilename,
  type Project,
} from '../../project/project';
import { deleteProjectLocal, listProjectsLocal, loadProjectLocal, saveProjectLocal, type ProjectSummary } from '../../project/storage';
import { editor, useEditor } from '../store';

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

export async function openFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  const creator = cloud.user?.username || editor.prefs.creatorName;
  let project: Project;
  const osz = files.find((f) => /\.(osz|zip)$/i.test(f.name));
  const hasOsu = files.some((f) => /\.osu$/i.test(f.name));
  if (osz) project = await importOsz(osz);
  else if (hasOsu) project = await importLooseFiles(files);
  else {
    const audio = files.find((f) => /\.(mp3|ogg|wav|m4a|flac)$/i.test(f.name) || f.type.startsWith('audio/'));
    if (!audio) throw new Error('Drop an audio file (mp3/ogg), an .osz, or a beatmap folder.');
    project = await createProjectFromAudio(audio, creator);
  }
  await saveProjectLocal(project);
  await editor.openProject(project);
  if (!hasOsu && !osz) {
    editor.openDialog('setup');
    editor.toast('New beatmap created. Fill in the song setup, then add a timing point (F6 or Ctrl+P).');
  }
}

/** Collect files from a drop, including whole folders. */
async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const items = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (items.length === 0) return [...dt.files];
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) {
      const f = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      Object.defineProperty(f, 'webkitRelativePath', { value: path + f.name });
      out.push(f);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, `${path}${entry.name}/`);
      } while (batch.length > 0);
    }
  };
  for (const it of items) await walk(it, '');
  return out;
}

export function Home() {
  useEditor();
  const userKey = useCloud();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [setLink, setSetLink] = useState('');
  const audioInput = useRef<HTMLInputElement>(null);
  const oszInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setProjects(await listProjectsLocal().catch(() => []));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!cloud.user) return;
    setBusy('Syncing with your account…');
    cloud
      .syncAll()
      .then((n) => n > 0 && editor.toast(`Synced ${n} beatmap${n > 1 ? 's' : ''} with your account.`))
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
      void refresh();
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = await filesFromDrop(e.dataTransfer);
    await run('Opening…', () => openFiles(files));
  };

  const openFromWebsite = () =>
    run('Downloading beatmap…', async () => {
      const m = /(?:beatmapsets\/|^)(\d+)/.exec(setLink.trim());
      if (!m) throw new Error('Paste a beatmapset link like https://osu.ppy.sh/beatmapsets/123456 or just the set id.');
      const data = await cloud.fetchBeatmapset(Number(m[1]));
      const p = await importOsz(data);
      await saveProjectLocal(p);
      await editor.openProject(p);
    });

  return (
    <div className={`home ${dragOver ? 'drag-over' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
      <header className="home-header">
        <div className="brand">
          <span className="logo">osu!</span> web editor
        </div>
        <Account />
      </header>

      <main className="home-main">
        <section className="dropzone">
          <h1>Drop an mp3 to start mapping</h1>
          <p>…or drop an <b>.osz</b> / beatmap folder to keep editing an existing map. Everything is saved in your browser automatically.</p>
          <div className="home-actions">
            <button className="primary" onClick={() => audioInput.current?.click()}>New beatmap from audio…</button>
            <button onClick={() => oszInput.current?.click()}>Open .osz…</button>
            <button onClick={() => folderInput.current?.click()}>Open beatmap folder…</button>
          </div>
          {cloud.available && (
            <div className="home-link">
              <input placeholder="osu.ppy.sh/beatmapsets/… link or set id" value={setLink} onChange={(e) => setSetLink(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && openFromWebsite()} />
              <button onClick={openFromWebsite} disabled={!setLink.trim()}>Open from osu!</button>
            </div>
          )}
          <input ref={audioInput} type="file" accept="audio/*,.mp3,.ogg" hidden onChange={(e) => run('Creating…', () => openFiles([...(e.target.files ?? [])]))} />
          <input ref={oszInput} type="file" accept=".osz,.zip" hidden onChange={(e) => run('Opening…', () => openFiles([...(e.target.files ?? [])]))} />
          <input
            ref={(el) => {
              folderInput.current = el;
              el?.setAttribute('webkitdirectory', '');
            }}
            type="file"
            hidden
            onChange={(e) => run('Opening…', () => openFiles([...(e.target.files ?? [])]))}
          />
        </section>

        <section className="projects">
          <h2>Your beatmaps {cloud.user ? <small>(synced with {cloud.user.username})</small> : <small>(this browser)</small>}</h2>
          {projects.length === 0 && <p className="muted">No beatmaps yet.</p>}
          <ul>
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  className="project-open"
                  onClick={() =>
                    run('Loading…', async () => {
                      const proj = await loadProjectLocal(p.id);
                      if (proj) await editor.openProject(proj);
                    })
                  }
                >
                  <span className="project-title">{p.title}</span>
                  <span className="project-diffs">{p.difficulties.join(' · ')}</span>
                </button>
                <span className="project-meta">
                  {timeAgo(p.updatedAt)}
                  {cloud.user && (p.syncedAt >= p.updatedAt ? ' · ☁ synced' : ' · not synced')}
                </span>
                <button
                  title="Export .osz"
                  onClick={() =>
                    run('Exporting…', async () => {
                      const proj = await loadProjectLocal(p.id);
                      if (proj) downloadBlob(await exportOsz(proj), oszFilename(proj));
                    })
                  }
                >
                  Export
                </button>
                <button
                  className="danger"
                  title="Delete"
                  onClick={() => {
                    if (!confirm(`Delete "${p.title}"? This cannot be undone.`)) return;
                    void run('Deleting…', async () => {
                      await deleteProjectLocal(p.id);
                      if (cloud.user) await cloud.remove(p.id);
                    });
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>
      {busy && <div className="busy">{busy}</div>}
    </div>
  );
}

export function Account() {
  useCloud();
  if (!cloud.available) return null;
  if (cloud.user) {
    return (
      <div className="account">
        {cloud.user.avatarUrl && <img src={cloud.user.avatarUrl} alt="" />}
        <span>{cloud.user.username}</span>
        <button onClick={() => void cloud.logout()}>Log out</button>
      </div>
    );
  }
  if (!cloud.oauthConfigured) return <div className="account muted" title="Set OSU_CLIENT_ID / OSU_CLIENT_SECRET on the server">osu! login not configured</div>;
  return (
    <div className="account">
      <button className="osu-login" onClick={() => cloud.login()}>Log in with osu!</button>
    </div>
  );
}
