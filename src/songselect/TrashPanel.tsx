// Recently deleted: deleted sets and difficulties wait here for TRASH_DAYS days, like stable's deletes going to the
// Recycle Bin.
import { useCallback, useEffect, useState } from 'react';
import { editor } from '../editor/store';
import { cloud } from '../project/cloud';
import { deleteTrashLocal, listTrashLocal, restoreTrashLocal, TRASH_DAYS, type TrashEntry } from '../project/storage';
import { ask, promptOpen } from '../ui/prompt';

const DAY = 24 * 60 * 60 * 1000;

function daysLeft(e: TrashEntry, now: number): string {
  const n = Math.max(1, Math.ceil((e.deletedAt + TRASH_DAYS * DAY - now) / DAY));
  return n === 1 ? '1 day left' : `${n} days left`;
}

const nameOf = (e: TrashEntry) => (e.version === null ? `${e.title} (whole set)` : `${e.title} [${e.version}]`);

async function sure(title: string, message: string, label: string): Promise<boolean> {
  const r = await ask({
    look: 'game',
    title,
    message,
    buttons: [
      { label, value: 'yes', tone: 'red' },
      { label: 'Cancel', value: 'no', tone: 'grey' },
    ],
    cancelValue: 'no',
  });
  return r === 'yes';
}

export function TrashPanel({ onClose, onRestored }: { onClose: () => void; onRestored: (setId: string) => void }) {
  const [entries, setEntries] = useState<TrashEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => listTrashLocal().then(setEntries, () => setEntries([])), []);
  useEffect(() => void reload(), [reload]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || promptOpen()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', on, { capture: true });
    return () => window.removeEventListener('keydown', on, { capture: true });
  }, [onClose]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      editor.toast((e as Error).message, 'error');
    } finally {
      await reload();
      setBusy(false);
    }
  };

  const restore = (e: TrashEntry) =>
    act(async () => {
      const p = await restoreTrashLocal(e.id);
      if (!p) return;
      editor.toast(`Restored ${nameOf(e)}.`);
      onRestored(p.id);
      await cloud.restore(p).catch((err) => editor.toast(`Cloud sync failed: ${err.message}`, 'error'));
    });

  const deleteForever = async (e: TrashEntry) => {
    const diffs = e.version === null && entries?.some((x) => x.version !== null && x.setId === e.id);
    if (!(await sure('Delete forever?', `${nameOf(e)}\n${diffs ? 'Its deleted difficulties go too. ' : ''}This can't be undone.`, 'Delete forever'))) return;
    await act(() => deleteTrashLocal([e.id]));
  };

  const empty = async () => {
    if (!entries?.length) return;
    if (!(await sure('Empty Recently deleted?', `${entries.length} deleted map${entries.length > 1 ? 's are' : ' is'} removed for good. This can't be undone.`, 'Empty now'))) return;
    await act(() => deleteTrashLocal(entries.map((x) => x.id)));
  };

  const now = Date.now();
  return (
    <div className="trash" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gdialog-head">
        <div className="gdialog-title">Recently deleted</div>
        <div className="gdialog-msg">Deleted maps can be restored for {TRASH_DAYS} days.</div>
      </div>
      <div className="trash-box">
        <div className="trash-top">
          <span>{entries ? (entries.length ? `${entries.length} deleted` : 'Nothing deleted') : 'Loading…'}</span>
          <button className="gdialog-btn tone-red trash-btn" disabled={busy || !entries?.length} onClick={() => void empty()}>Empty now</button>
        </div>
        <div className="trash-list">
          {entries?.map((e) => (
            <div key={e.id} className="trash-row">
              <span className="trash-name" title={nameOf(e)}>
                {e.title} <span className="trash-what">{e.version === null ? '(whole set)' : `[${e.version}]`}</span>
              </span>
              <span className="trash-left">{daysLeft(e, now)}</span>
              <button className="gdialog-btn tone-blue trash-btn" disabled={busy} onClick={() => void restore(e)}>Restore</button>
              <button className="gdialog-btn tone-red trash-btn" disabled={busy} onClick={() => void deleteForever(e)}>Delete forever</button>
            </div>
          ))}
        </div>
      </div>
      <div className="gdialog-buttons">
        <button className="gdialog-btn tone-grey" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
