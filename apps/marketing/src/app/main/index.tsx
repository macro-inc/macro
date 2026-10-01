/* @refresh reload */
import { render } from 'solid-js/web';
import './index.css';

import { preserveHeroEntrance } from '../utils/utilHeroEntrance';
import { App } from './App';

const root = document.getElementById('root');

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    'Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?'
  );
}

// Prerendered builds ship static HTML inside #root for crawlers and first
// paint; Solid's render() appends rather than hydrates, so drop it first.
const finishHeroHandoff = preserveHeroEntrance(root!);
root!.textContent = '';

render(() => <App />, root!);
finishHeroHandoff();
