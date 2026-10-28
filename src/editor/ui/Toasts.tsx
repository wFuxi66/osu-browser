import { useEditor } from '../store';

export function Toasts() {
  const ed = useEditor();
  return (
    <div className="toasts">
      {ed.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}${t.action ? ' has-action' : ''}`}>
          {t.text}
          {t.action && <button onClick={t.action.run}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}
