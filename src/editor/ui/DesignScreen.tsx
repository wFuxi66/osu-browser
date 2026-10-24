import { useEffect, useState } from 'react';
import { editor, useEditor } from '../store';

/**
 * F2 design mode. Storyboard scripting is edited as text (difficulty-specific events and the shared .osb);
 * everything is preserved verbatim on export.
 */
export function DesignScreen() {
  const ed = useEditor();
  const project = ed.project!;
  const osbName = [...project.files.keys()].find((n) => n.toLowerCase().endsWith('.osb')) ?? defaultOsbName();
  const [osb, setOsb] = useState('');
  const [diffSb, setDiffSb] = useState(ed.bm.events.storyboardLines.join('\n'));

  useEffect(() => {
    const blob = project.files.get(osbName);
    if (blob) void blob.text().then(setOsb);
    else setOsb('[Events]\n//Background and Video events\n//Storyboard Layer 0 (Background)\n//Storyboard Layer 1 (Fail)\n//Storyboard Layer 2 (Pass)\n//Storyboard Layer 3 (Foreground)\n//Storyboard Layer 4 (Overlay)\n//Storyboard Sound Samples\n');
  }, [osbName, project]);

  useEffect(() => setDiffSb(ed.bm.events.storyboardLines.join('\n')), [ed.diffIndex, ed.bm]);

  const images = [...project.files.keys()].filter((n) => /\.(png|jpe?g|gif)$/i.test(n));
  const sounds = [...project.files.keys()].filter((n) => /\.(wav|ogg|mp3)$/i.test(n));

  return (
    <div className="design-screen">
      <div className="design-col">
        <h3>Storyboard (.osb, shared by all difficulties)</h3>
        <textarea spellCheck={false} value={osb} onChange={(e) => setOsb(e.target.value)} />
        <div className="row">
          <button
            className="primary"
            onClick={() => {
              editor.setFile(osbName, new Blob([osb.replace(/\r?\n/g, '\r\n')], { type: 'text/plain' }));
              editor.toast(`Saved ${osbName}`);
            }}
          >
            Apply .osb
          </button>
          <span className="muted">{osbName}</span>
        </div>
        <h3>Difficulty-specific storyboard ([Events] in the .osu)</h3>
        <textarea spellCheck={false} value={diffSb} onChange={(e) => setDiffSb(e.target.value)} />
        <div className="row">
          <button
            className="primary"
            onClick={() =>
              editor.commit((bm) => {
                bm.events.storyboardLines = diffSb.split(/\r?\n/).filter((l) => l.trim().length > 0);
              })
            }
          >
            Apply difficulty storyboard
          </button>
        </div>
      </div>
      <div className="design-col narrow">
        <h3>Sprite library</h3>
        <p className="muted">Files in the beatmap folder you can reference from the storyboard. Add more with File → Add files.</p>
        <ul className="file-list">
          {images.map((n) => <li key={n}>🖼 {n}</li>)}
          {sounds.map((n) => <li key={n}>🔊 {n}</li>)}
        </ul>
        <h3>Quick reference</h3>
        <pre className="sb-ref">{`Sprite,<layer>,<origin>,"<file>",<x>,<y>
Animation,<layer>,<origin>,"<file>",<x>,<y>,<frames>,<delay>,<LoopForever|LoopOnce>
 F,<easing>,<start>,<end>,<opacity1>,<opacity2>
 M,<easing>,<start>,<end>,<x1>,<y1>,<x2>,<y2>
 S / V / R / C / MX / MY / P
 L,<start>,<loopcount>   T,<trigger>,<start>,<end>
Sample,<time>,<layer>,"<file>",<volume>`}</pre>
      </div>
    </div>
  );
}

function defaultOsbName(): string {
  const m = editor.bm.metadata;
  return `${m.artist} - ${m.title} (${m.creator}).osb`.replace(/[\\/:*?"<>|]/g, '');
}
