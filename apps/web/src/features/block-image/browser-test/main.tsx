import { For } from 'solid-js';
import { render } from 'solid-js/web';
import { ImageContent } from '../component/ImageContent';
import '../../../index.css';

// A viewBox-only SVG, as most exported SVGs are: no intrinsic size, so
// browsers report it as 300×150.
const SVG = new Blob(
  [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect width="400" height="200" fill="#3b82f6"/><circle cx="200" cy="100" r="60" fill="#f59e0b"/><text x="200" y="102" font-size="5" text-anchor="middle">fine detail</text></svg>',
  ],
  { type: 'image/svg+xml' }
);

const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
render(
  () => (
    <main class="flex h-dvh flex-col bg-page text-ink">
      <ul
        data-testid="scroll-list"
        class="h-24 shrink-0 overflow-y-auto border-b border-edge"
      >
        <For each={Array.from({ length: 30 }, (_, i) => i)}>
          {(i) => <li class="h-8 px-4">Row {i}</li>}
        </For>
      </ul>
      <div
        data-testid="image-pane"
        class="relative size-full min-h-0 min-w-0 overflow-hidden"
      >
        <ImageContent file={SVG} alt="Diagram" />
      </div>
    </main>
  ),
  root
);
