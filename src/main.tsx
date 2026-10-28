import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installShortcuts } from './editor/shortcuts';
import './editor/playback';
import './ui/touch';
import '@fontsource/ubuntu/300.css';
import '@fontsource/ubuntu/400.css';
import '@fontsource/ubuntu/500.css';
import '@fontsource/ubuntu/700.css';
import './styles.css';
import './stable.css';
import './editor.css';
import './play.css';
import { registerServiceWorker } from './pwa/register';

installShortcuts();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
