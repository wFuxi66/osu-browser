// The Options panel, like stable's: slides in from the left over song select or the editor, with a section column,
// a search box and every setting of osu!browser (account and sync, audio, skin, editor display, downloads, keys).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useCloud } from '../App';
import { ACTIONS, bind, comboOf, conflicts, keyLabel, keysFor, resetBinding, unbind } from '../editor/keybinds';
import { layoutCode } from '../editor/shortcuts';
import { editor, useEditor } from '../editor/store';
import { cloud } from '../project/cloud';
import { DRIVE_FOLDER } from '../project/drive';
import { pickFiles } from '../project/open';
import { skins, type SkinEntry } from '../skin/skin';
import { options, useOptions, type OptionsSection } from './options';
import { confirmBox } from './prompt';
import { scores } from '../play/scores';
import { installApp, useCanInstall } from '../pwa/install';

interface Item {
  label: string;
  /** Extra words the search box matches. */
  keywords?: string;
  render: () => ReactNode;
}

interface Group {
  title: string;
  items: Item[];
}

interface Section {
  id: OptionsSection;
  title: string;
  icon: ReactNode;
  groups: Group[];
}

export function OptionsPanel() {
  const opts = useOptions();
  const ed = useEditor();
  useCloud();
  const canInstall = useCanInstall();
  const [query, setQuery] = useState('');
  const [capture, setCapture] = useState<{ id: string; slot: number } | null>(null);
  const [skinList, setSkinList] = useState<SkinEntry[]>([]);
  const body = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const sectionEls = useRef(new Map<OptionsSection, HTMLElement>());
  const p = ed.prefs;

  const refreshSkins = () => void skins.list().then(setSkinList);
  useEffect(() => {
    if (opts.open) refreshSkins();
    else setCapture(null);
  }, [opts.open]);

  // Jump to the asked-for section, just under the sticky search header.
  const [active, setActive] = useState<OptionsSection>('general');
  useEffect(() => {
    if (!opts.open) return;
    const el = sectionEls.current.get(opts.section);
    const b = body.current;
    if (!el || !b) return;
    const first = sections[0].id === opts.section;
    b.scrollTo({ top: first ? 0 : el.offsetTop - (head.current?.offsetHeight ?? 0) });
    setActive(opts.section);
  }, [opts.rev]);
  // The section column follows the scrolling.
  const onScroll = () => {
    const b = body.current;
    if (!b) return;
    const line = b.scrollTop + (head.current?.offsetHeight ?? 0) + 24;
    let cur = sections[0].id;
    for (const sec of sections) {
      const el = sectionEls.current.get(sec.id);
      if (el?.isConnected && el.offsetTop <= line) cur = sec.id;
    }
    setActive(cur);
  };

  // Esc closes (or cancels a key capture); the rest of the app ignores keys while the panel is open.
  useEffect(() => {
    if (!opts.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (capture) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') return setCapture(null);
        const combo = comboOf(e, layoutCode(e));
        if (!combo) return;
        const taken = conflicts(capture.id, combo, p.keybinds);
        ed.setPrefs({ keybinds: bind(p.keybinds, capture.id, combo, capture.slot) });
        if (taken.length) editor.toast(`${keyLabel(combo)} was used by "${taken.map((t) => t.label).join('", "')}", which no longer has it.`);
        setCapture(null);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        options.hide();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [opts.open, capture, p.keybinds]);

  const set = (patch: Partial<typeof p>) => ed.setPrefs(patch);
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  const importSkin = async (directory: boolean) => {
    const files = await pickFiles(directory ? '' : '.osk,.zip', { directory, multiple: directory });
    if (!files.length) return;
    try {
      const entry = await skins.import(files);
      set({ skin: entry.id });
      refreshSkins();
      editor.toast(`Imported the skin "${entry.name}".`);
    } catch (e) {
      editor.toast(`Couldn't import the skin: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  };
  const currentSkin = skinList.find((s) => s.id === p.skin);

  // Leaving the page for a sign-in loses unsaved edits, so ask first, as the editor's menus do.
  const leaveFor = async (go: () => void) => {
    if (await editor.resolveUnsaved()) go();
  };

  const sections: Section[] = [
    {
      id: 'general',
      title: 'General',
      icon: <IconGeneral />,
      groups: [
        {
          title: 'Sign in',
          items: [
            {
              label: 'osu! account',
              keywords: 'login log in log out user profile my beatmaps',
              render: () =>
                cloud.user ? (
                  <div className="op-account">
                    {cloud.user.avatarUrl && <img src={cloud.user.avatarUrl} alt="" />}
                    <div>
                      <div className="op-account-name">{cloud.user.username}</div>
                      <div className="op-hint">New maps are signed with your name. Your uploaded maps are under "My beatmaps" in Search &amp; download.</div>
                    </div>
                    <Button tone="grey" onClick={() => void cloud.logout()}>Log out</Button>
                  </div>
                ) : cloud.oauthConfigured ? (
                  <>
                    <Button tone="pink" onClick={() => void leaveFor(() => cloud.login())}>Log in with osu!</Button>
                    <div className="op-hint">Signs new maps with your name and lists the maps you uploaded, ready to open.</div>
                  </>
                ) : (
                  <div className="op-hint">osu! login isn't available {cloud.available ? 'on this server' : 'offline'}.</div>
                ),
            },
            {
              label: 'Google Drive sync',
              keywords: 'cloud backup drive google sync computers',
              render: () =>
                !cloud.driveConfigured ? (
                  <div className="op-hint">Google Drive sync isn't available {cloud.available ? 'on this server' : 'offline'}. Maps are saved in this browser.</div>
                ) : cloud.syncing ? (
                  <>
                    <div className="op-status ok">Your maps sync to the "{DRIVE_FOLDER}" folder in your Google Drive.</div>
                    <Button tone="grey" onClick={() => void cloud.disconnectDrive().then(() => editor.toast('Stopped syncing with Google Drive. The maps already there stay in your Drive.'))}>
                      Stop syncing
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="op-status warn">Maps are only saved in this browser: clearing its site data deletes them.</div>
                    <Button tone="blue" onClick={() => void leaveFor(() => cloud.connectDrive())}>Sync my maps with Google Drive</Button>
                    <div className="op-hint">They go in a "{DRIVE_FOLDER}" folder, and the editor can only see the files it creates.</div>
                  </>
                ),
            },
            {
              label: 'Sync these settings between computers',
              keywords: 'google drive settings options key bindings',
              render: () => (
                <Toggle
                  label="Sync these settings between computers"
                  hint={cloud.syncing ? 'Through your Google Drive. Audio offset and imported skins stay per computer.' : 'Needs Google Drive sync.'}
                  value={p.syncSettings && cloud.syncing}
                  disabled={!cloud.syncing}
                  onChange={(v) => {
                    set({ syncSettings: v });
                    if (v) void editor.syncSettings();
                  }}
                />
              ),
            },
          ],
        },
        {
          title: 'Mapping',
          items: [
            {
              label: 'Creator name',
              keywords: 'mapper username new beatmap',
              render: () => (
                <label className="op-field">
                  <span>Creator name for new maps{cloud.user ? ' (your osu! name is used while logged in)' : ''}</span>
                  <input value={p.creatorName} placeholder={cloud.user?.username ?? 'Your name'} onChange={(e) => set({ creatorName: e.target.value })} />
                </label>
              ),
            },
          ],
        },
      ],
    },
    {
      id: 'graphics',
      title: 'Graphics',
      icon: <IconGraphics />,
      groups: [
        {
          title: 'Renderer',
          items: [{ label: 'Show FPS counter', keywords: 'frames performance', render: () => <Toggle label="Show FPS counter" hint="In the bottom-right corner while playing." value={p.showFps} onChange={(v) => set({ showFps: v })} /> }],
        },
        {
          title: 'Detail settings',
          items: [
            { label: 'Snaking sliders', keywords: 'gameplay', render: () => <Toggle label="Snaking sliders" value={p.playSnaking} onChange={(v) => set({ playSnaking: v })} /> },
            { label: 'Background video', keywords: 'gameplay video', render: () => <Toggle label="Background video" value={p.playVideo} onChange={(v) => set({ playVideo: v })} /> },
            { label: 'Storyboards', keywords: 'gameplay storyboard', render: () => <Toggle label="Storyboards" value={p.playStoryboard} onChange={(v) => set({ playStoryboard: v })} /> },
          ],
        },
        {
          title: 'Main menu',
          items: [
            { label: 'Parallax', keywords: 'background move mouse', render: () => <Toggle label="Parallax" value={p.menuParallax} onChange={(v) => set({ menuParallax: v })} /> },
            { label: 'Menu tips', keywords: 'hints', render: () => <Toggle label="Menu tips" value={p.menuTips} onChange={(v) => set({ menuTips: v })} /> },
          ],
        },
      ],
    },
    {
      id: 'gameplay',
      title: 'Gameplay',
      icon: <IconGameplay />,
      groups: [
        {
          title: 'General',
          items: [
            { label: 'Background dim', keywords: 'dim gameplay play', render: () => <Slider label="Background dim" value={p.playDim} min={0} max={1} step={0.05} format={pct} onChange={(v) => set({ playDim: v })} /> },
            { label: "Don't change dim level during breaks", keywords: 'dim break', render: () => <Toggle label="Don't change dim level during breaks" value={p.keepDimInBreaks} onChange={(v) => set({ keepDimInBreaks: v })} /> },
            { label: 'Show leaderboard during gameplay', keywords: 'scores local ranking', render: () => <Toggle label="Show leaderboard during gameplay" value={p.showLeaderboard} onChange={(v) => set({ showLeaderboard: v })} /> },
            {
              label: 'Progress display',
              keywords: 'pie bar song progress',
              render: () => (
                <Choice
                  label="Progress display"
                  value={p.progressDisplay}
                  options={[['topright', 'Top-Right (Pie)'], ['bottomright', 'Bottom-Right (Pie)'], ['bottom', 'Bottom (Bar)'], ['none', 'None']]}
                  onChange={(v) => set({ progressDisplay: v })}
                />
              ),
            },
            {
              label: 'Score meter type',
              keywords: 'hit error unstable rate timing',
              render: () => <Choice label="Score meter type" value={p.scoreMeter} options={[['none', 'None'], ['colour', 'Colour'], ['error', 'Hit error']]} onChange={(v) => set({ scoreMeter: v })} />,
            },
            { label: 'Score meter size', keywords: 'hit error', render: () => <Slider label="Score meter size" value={p.scoreMeterSize} min={0.5} max={2} step={0.05} format={(v) => `${v.toFixed(2)}x`} onChange={(v) => set({ scoreMeterSize: v })} /> },
            { label: 'Always show key overlay', keywords: 'keys k1 k2 input', render: () => <Toggle label="Always show key overlay" hint="It always shows during autoplay." value={p.keyOverlay} onChange={(v) => set({ keyOverlay: v })} /> },
            { label: 'Show approach circle on first "Hidden" object', keywords: 'hd mod', render: () => <Toggle label={'Show approach circle on first "Hidden" object'} value={p.hiddenFirstApproach} onChange={(v) => set({ hiddenFirstApproach: v })} /> },
          ],
        },
        {
          title: 'Song select',
          items: [{ label: 'Show thumbnails', keywords: 'carousel background images', render: () => <Toggle label="Show thumbnails" value={p.showThumbnails} onChange={(v) => set({ showThumbnails: v })} /> }],
        },
      ],
    },
    {
      id: 'audio',
      title: 'Audio',
      icon: <IconAudio />,
      groups: [
        {
          title: 'Volume',
          items: [
            { label: 'Master', keywords: 'volume', render: () => <Slider label="Master" value={p.masterVolume} min={0} max={1} step={0.01} format={pct} onChange={(v) => set({ masterVolume: v })} /> },
            { label: 'Music', keywords: 'volume song', render: () => <Slider label="Music" value={p.musicVolume} min={0} max={1} step={0.01} format={pct} onChange={(v) => set({ musicVolume: v })} /> },
            { label: 'Effect', keywords: 'volume hitsounds samples', render: () => <Slider label="Effect" value={p.hitsoundVolume} min={0} max={1} step={0.01} format={pct} onChange={(v) => set({ hitsoundVolume: v })} /> },
            {
              label: 'Ignore beatmap hitsounds',
              keywords: 'samples custom gameplay',
              render: () => <Toggle label="Ignore beatmap hitsounds" hint="While playing, the skin's samples play instead of the beatmap's own. The editor always uses the beatmap's." value={p.ignoreBeatmapHitsounds} onChange={(v) => set({ ignoreBeatmapHitsounds: v })} />,
            },
          ],
        },
        {
          title: 'Offset adjustment',
          items: [
            {
              label: 'Universal offset',
              keywords: 'latency delay sync audio offset',
              render: () => (
                <>
                  <Slider label="Universal offset" value={p.audioOffset} min={-200} max={200} step={1} format={(v) => `${v} ms`} onChange={(v) => set({ audioOffset: v })} />
                  <div className="op-hint">Positive if hitsounds play too early. Kept per computer.</div>
                </>
              ),
            },
          ],
        },
      ],
    },
    {
      id: 'skin',
      title: 'Skin',
      icon: <IconSkin />,
      groups: [
        {
          title: 'Skin',
          items: [
            {
              label: 'Current skin',
              keywords: 'skin osk theme',
              render: () => (
                <>
                  <label className="op-field">
                    <span>Current skin</span>
                    <select value={p.skin} onChange={(e) => set({ skin: e.target.value })}>
                      {skinList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </label>
                  <div className="op-buttons">
                    <Button tone="blue" onClick={() => void importSkin(false)}>Import .osk</Button>
                    <Button tone="blue" onClick={() => void importSkin(true)}>Import skin folder</Button>
                    <Button
                      tone="grey"
                      disabled={!currentSkin || currentSkin.builtin}
                      onClick={async () => {
                        if (!currentSkin || !(await confirmBox('osu!', `Delete the skin "${currentSkin.name}" from this browser?`))) return;
                        await skins.remove(currentSkin.id);
                        set({ skin: skins.currentId });
                        refreshSkins();
                      }}
                    >
                      Delete skin
                    </Button>
                  </div>
                  <div className="op-hint">Imported skins stay in this browser and are never uploaded.</div>
                </>
              ),
            },
            {
              label: "Use the beatmap's own skin",
              keywords: 'beatmap skins hitcircle ignore',
              render: () => (
                <Toggle
                  label="Use the beatmap's own skin"
                  hint="Hit circles, numbers and other elements the beatmap folder includes are drawn instead of your skin's."
                  value={p.beatmapSkins}
                  onChange={(v) => set({ beatmapSkins: v })}
                />
              ),
            },
            {
              label: 'Use the default skin in the editor',
              keywords: 'editor default skin mapping',
              render: () => (
                <Toggle
                  label="Use the default skin in the editor"
                  hint="Map with osu!default whatever skin you play with. Test play still uses your skin."
                  value={p.editorDefaultSkin}
                  onChange={(v) => set({ editorDefaultSkin: v })}
                />
              ),
            },
            { label: 'Cursor size', keywords: 'cursor scale', render: () => <Slider label="Cursor size" value={p.cursorSize} min={0.5} max={2} step={0.05} format={(v) => `${v.toFixed(2)}x`} onChange={(v) => set({ cursorSize: v })} /> },
            { label: 'Automatic cursor size', keywords: 'cursor circle size', render: () => <Toggle label="Automatic cursor size" hint="Smaller on maps with small circles." value={p.autoCursorSize} onChange={(v) => set({ autoCursorSize: v })} /> },
            {
              label: 'Skinned timeline',
              keywords: 'timeline circles skin',
              render: () => <Toggle label="Draw the timeline's circles with the skin" value={p.skinnedTimeline} onChange={(v) => set({ skinnedTimeline: v })} />,
            },
          ],
        },
      ],
    },
    {
      id: 'editor',
      title: 'Editor',
      icon: <IconEditor />,
      groups: [
        {
          title: 'Playfield',
          items: [
            { label: 'Background dim', keywords: 'dim background', render: () => <Slider label="Background dim" value={p.backgroundDim} min={0} max={1} step={0.05} format={pct} onChange={(v) => set({ backgroundDim: v })} /> },
            { label: 'Show the grid', keywords: 'grid lines', render: () => <Toggle label="Show the grid" hint="G changes its size. Grid snap (T) only decides whether objects snap to it." value={p.showGrid} onChange={(v) => set({ showGrid: v })} /> },
            {
              label: 'Advance after placing',
              keywords: 'auto advance playhead next tick stable',
              render: () => (
                <Toggle
                  label="Advance after placing"
                  hint="While the song is paused: a circle moves the playhead to the next beat-divisor tick, a slider or spinner to its end, so the next object doesn't land on the one just placed."
                  value={p.autoAdvance}
                  onChange={(v) => set({ autoAdvance: v })}
                />
              ),
            },
            { label: 'Hit animations', render: () => <Toggle label="Hit animations" value={p.showHitAnimations} onChange={(v) => set({ showHitAnimations: v })} /> },
            { label: 'Follow points', render: () => <Toggle label="Follow points" value={p.showFollowPoints} onChange={(v) => set({ showFollowPoints: v })} /> },
            { label: 'Snaking sliders', render: () => <Toggle label="Snaking sliders" value={p.snakingSliders} onChange={(v) => set({ snakingSliders: v })} /> },
            { label: 'Storyboard', render: () => <Toggle label="Storyboard" value={p.showStoryboard} onChange={(v) => set({ showStoryboard: v })} /> },
            { label: 'Video', render: () => <Toggle label="Background video" value={p.showVideo} onChange={(v) => set({ showVideo: v })} /> },
          ],
        },
        {
          title: 'Timeline',
          items: [
            { label: 'Timeline waveform', keywords: 'waveform', render: () => <Toggle label="Song waveform in the timeline" value={p.showWaveform} onChange={(v) => set({ showWaveform: v })} /> },
            { label: 'Invert mouse wheel seeking', keywords: 'scroll wheel', render: () => <Toggle label="Invert mouse wheel seeking" hint="Off: wheel down (or dragging the touch jog strip down) seeks forward." value={p.invertScroll} onChange={(v) => set({ invertScroll: v })} /> },
          ],
        },
      ],
    },
    {
      id: 'downloads',
      title: 'Downloads',
      icon: <IconDownload />,
      groups: [
        {
          title: 'osu!direct',
          items: [
            {
              label: 'Download beatmaps with video',
              keywords: 'video no video download size',
              render: () => (
                <Toggle
                  label="Download beatmaps with video"
                  hint="Off: sets come without their video, so they download faster and take less space in the browser and in Drive."
                  value={p.downloadVideo}
                  onChange={(v) => set({ downloadVideo: v })}
                />
              ),
            },
          ],
        },
      ],
    },
    {
      id: 'maintenance',
      title: 'Maintenance',
      icon: <IconMaintenance />,
      groups: [
        {
          title: 'General',
          items: [
            ...(canInstall
              ? [
                  {
                    label: 'Install osu!browser as an app',
                    keywords: 'download desktop icon shortcut pwa window',
                    render: () => (
                      <Button tone="grey" onClick={() => void installApp()}>
                        Install osu!browser as an app
                      </Button>
                    ),
                  },
                ]
              : []),
            {
              label: 'Delete all local scores',
              keywords: 'scores ranking leaderboard clear reset',
              render: () => (
                <Button
                  tone="grey"
                  onClick={async () => {
                    if (await confirmBox('osu!', 'Delete every score set in this browser?')) {
                      scores.clear();
                      editor.toast('Deleted all local scores.');
                    }
                  }}
                >
                  Delete all local scores
                </Button>
              ),
            },
          ],
        },
      ],
    },
    {
      id: 'input',
      title: 'Input',
      icon: <IconInput />,
      groups: [
        {
          title: 'Mouse',
          items: [
            {
              label: 'Disable mouse wheel in play mode',
              keywords: 'scroll volume gameplay',
              render: () => <Toggle label="Disable mouse wheel in play mode" hint="Otherwise the wheel changes the volume while playing." value={p.disableWheelInPlay} onChange={(v) => set({ disableWheelInPlay: v })} />,
            },
            { label: 'Disable mouse buttons in play mode', keywords: 'click gameplay keys', render: () => <Toggle label="Disable mouse buttons in play mode" value={p.disableMouseButtons} onChange={(v) => set({ disableMouseButtons: v })} /> },
          ],
        },
        ...[...new Set(ACTIONS.map((x) => x.group))].map((group) => ({
          title: `Keys: ${group}`,
          items: ACTIONS.filter((x) => x.group === group).map((x) => ({
            label: x.label,
            keywords: `key binding shortcut ${group} ${keysFor(x.id, p.keybinds).map(keyLabel).join(' ')}`,
            render: () => <KeyRow id={x.id} label={x.label} capture={capture} onCapture={setCapture} />,
          })),
        })),
        {
          title: 'All keys',
          items: [
            {
              label: 'Reset all key bindings',
              keywords: 'key binding default',
              render: () => (
                <Button
                  tone="grey"
                  disabled={Object.keys(p.keybinds).length === 0}
                  onClick={async () => {
                    if (await confirmBox('osu!', 'Reset every key binding to its default?')) set({ keybinds: {} });
                  }}
                >
                  Reset all key bindings
                </Button>
              ),
            },
          ],
        },
      ],
    },
  ];

  // Stable's order.
  const order: OptionsSection[] = ['general', 'graphics', 'gameplay', 'audio', 'skin', 'input', 'editor', 'downloads', 'maintenance'];
  sections.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (it: Item, group: Group, s: Section) => {
    const hay = `${it.label} ${it.keywords ?? ''} ${group.title} ${s.title}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  if (!opts.open) return null;
  return (
    <div className="op-wrap" onMouseDown={(e) => e.target === e.currentTarget && options.hide()} onWheel={(e) => e.stopPropagation()}>
      <div className="op-panel" onDragOver={(e) => e.stopPropagation()}>
        <nav className="op-nav">
          {sections.map((s) => (
            <button key={s.id} className={active === s.id ? 'active' : ''} title={s.title} onClick={() => options.goto(s.id)}>
              {s.icon}
            </button>
          ))}
          <button className="op-nav-close" title="Close (Esc)" onClick={() => options.hide()}>×</button>
        </nav>
        <div className="op-body" ref={body} onScroll={onScroll}>
          <div className="op-head" ref={head}>
            <div className="op-title">Options</div>
            <div className="op-sub">Change the way osu!browser behaves</div>
            <input className="op-search" placeholder="Type to search!" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          </div>
          {sections.map((s) => {
            const groups = s.groups.map((g) => ({ g, items: g.items.filter((it) => matches(it, g, s)) })).filter((x) => x.items.length);
            if (!groups.length) return null;
            return (
              <section key={s.id} className="op-section" ref={(el) => { if (el) sectionEls.current.set(s.id, el); }}>
                <h2>{s.title}</h2>
                {groups.map(({ g, items }) => (
                  <div key={g.title} className="op-group">
                    <h3>{g.title}</h3>
                    {items.map((it) => (
                      <div key={it.label} className="op-item">{it.render()}</div>
                    ))}
                  </div>
                ))}
              </section>
            );
          })}
          {words.length > 0 && !sections.some((s) => s.groups.some((g) => g.items.some((it) => matches(it, g, s)))) && (
            <div className="op-hint op-none">No options match "{query}".</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ controls

function Toggle({ label, value, onChange, hint, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean }) {
  return (
    <label className={`op-toggle ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="op-check" aria-hidden />
      <span>
        {label}
        {hint && <span className="op-hint">{hint}</span>}
      </span>
    </label>
  );
}

function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="op-slider">
      <span className="op-slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="op-slider-value">{format(value)}</span>
    </label>
  );
}

function Choice<T extends string>({ label, value, options: choices, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className="op-field op-choice">
      <span>{label}:</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {choices.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function Button({ tone, children, onClick, disabled }: { tone: 'pink' | 'blue' | 'grey'; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button className={`op-button ${tone}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** One action's keys: click a key to change it (then press the new key), right-click to remove it. */
function KeyRow({ id, label, capture, onCapture }: { id: string; label: string; capture: { id: string; slot: number } | null; onCapture: (c: { id: string; slot: number } | null) => void }) {
  const ed = useEditor();
  const binds = ed.prefs.keybinds;
  const keys = keysFor(id, binds);
  const slots = keys.length < 2 ? [...keys, null] : keys;
  return (
    <div className="op-keyrow">
      <span className="op-keyrow-label">{label}</span>
      <span className="op-keys">
        {slots.map((k, i) => {
          const waiting = capture?.id === id && capture.slot === i;
          return (
            <button
              key={i}
              className={`op-key ${waiting ? 'waiting' : ''} ${k ? '' : 'empty'}`}
              title={k ? 'Click to change, right-click to remove' : 'Click to add a key'}
              onClick={() => onCapture(waiting ? null : { id, slot: i })}
              onContextMenu={(e) => {
                e.preventDefault();
                if (k) ed.setPrefs({ keybinds: unbind(binds, id, i) });
              }}
            >
              {waiting ? 'Press a key…' : k ? keyLabel(k) : '+'}
            </button>
          );
        })}
        {binds[id] && (
          <button className="op-key-reset" title="Back to the default" onClick={() => ed.setPrefs({ keybinds: resetBinding(binds, id) })}>
            ↺
          </button>
        )}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ section icons

const svg = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);
const IconGeneral = () => svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>);
const IconAudio = () => svg(<><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></>);
const IconSkin = () => svg(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /></>);
const IconEditor = () => svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></>);
const IconDownload = () => svg(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>);
const IconGraphics = () => svg(<><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>);
const IconGameplay = () => svg(<circle cx="12" cy="12" r="8.5" />);
const IconMaintenance = () => svg(<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z" />);
const IconInput = () => svg(<><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>);
