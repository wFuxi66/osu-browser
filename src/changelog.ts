// What changed for players, newest first. The "new version available" toast shows the lines the waiting version
// has that the running one doesn't, so add a line with each change worth telling players about (the build puts
// this list in the service worker too). Lines are matched by their text: don't reword one that has shipped.
export const CHANGELOG: string[] = [
  'Progress notices (video conversion, downloads) hide after a few seconds instead of staying in the corner.',
  'Leaving a map while the song plays, it keeps playing from where you were (quitting from the pause menu starts it over, like stable).',
  'Editor: the mouse wheel seeks on the timing screen too.',
  'Drawn (no images) skin: slider ends now show a circle.',
  'Editor: hold Alt to see and drag the distance spacing slider at the top right, like stable.',
  'Editor: grid snap and distance snap stay how you left them after a reload.',
  'Song select: panels glide into place when you pick a map or open a group, and collections are here (F3 > Manage collections, then group by Collections).',
  'Fixed a blank screen on reload after an update was downloaded while it was being published.',
  'Editor: 150% playback rate, to preview a map at DT speed.',
  'Editor: Song Folder looks and works like Explorer, with folders, drop to add, multi-select, previews and downloads. Notepad gets Ctrl+S and a status bar.',
  'The new version notice shows what changed before you reload.',
  'Editor: smoother seeking and zooming, and menus, dialogs, toasts and screen changes animate.',
  'Install osu!browser as an app from Options.',
  'Touch: select several objects on the timeline, smoother flings, and half-placed sliders stay visible.',
  'Phone layout: menus and bars move to the sides for a bigger playfield.',
  'Recently deleted: deleted sets and difficulties can be restored for 30 days.',
  'Works offline as an installed app, and Drive sync keeps both versions of a map changed in two places.',
  'Set downloads come from the mirror that has the latest version on osu!.',
];
