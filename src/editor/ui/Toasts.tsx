import { useEditor } from '../store';

export function Toasts() {
  const ed = useEditor();
  return (
    <div className="toasts">
      {ed.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
