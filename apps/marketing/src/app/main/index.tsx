/* @refresh reload */
import { render } from 'solid-js/web';
import './index.css';

import { preserveHeroEntrance } from '../utils/utilHeroEntrance';
import { App, preloadProductRoute } from './App';

const root = document.getElementById('root');

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    'Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?'
  );
}

async function startWebsite() {
  // Keep the first paint until the requested page and its styles exist.
  // Do not await this at module scope: a lazy route may import shared code
  // Rollup placed in this entry, so the entry must finish evaluating first.
  await preloadProductRoute(window.location.pathname);

  // Solid render appends rather than hydrates product pages.
  const finishHeroHandoff = preserveHeroEntrance(root!);
  root!.textContent = '';
  render(() => <App />, root!);
  finishHeroHandoff();
}

startWebsite().catch((error) => {
  console.error('Unable to initialize the public website', error);
});
