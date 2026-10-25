import '@app/index.css';
import { createSignal, For, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { floatWithSelection } from '../floatWithSelection';

const PANEL_DECORATION_HEIGHT = 18;
const MAX_CONTENT_HEIGHT = 256;

function Menu(props: { rows: number }) {
  const [availableHeight, setAvailableHeight] = createSignal<number>();
  const contentMaxHeight = () => {
    const h = availableHeight();
    if (h === undefined) return MAX_CONTENT_HEIGHT;
    return Math.min(
      MAX_CONTENT_HEIGHT,
      Math.max(0, h - PANEL_DECORATION_HEIGHT)
    );
  };
  return (
    <div
      data-testid="menu"
      class="w-64 z-modal-content"
      ref={(el) =>
        floatWithSelection(el, () => ({
          selection: document.getSelection(),
          onAvailableHeight: setAvailableHeight,
          fullHeight: MAX_CONTENT_HEIGHT + PANEL_DECORATION_HEIGHT,
        }))
      }
    >
      <div class="menu-surface rounded-xl p-px py-2">
        <div
          class="overflow-y-auto"
          style={{ 'max-height': `${contentMaxHeight()}px` }}
        >
          <For each={Array.from({ length: props.rows }, (_, i) => i + 1)}>
            {(row) => <div class="flex h-9 items-center px-2">Row {row}</div>}
          </For>
        </div>
      </div>
    </div>
  );
}

// A composer near the bottom (above a dock) or near the top of a phone
// screen. Its menu opens with one row, as a list filtered by a stale term
// does, and grows to its full list a moment later.
function Fixture() {
  const caretAtTop =
    new URLSearchParams(location.search).get('caret') === 'top';
  const [open, setOpen] = createSignal(false);
  const [rows, setRows] = createSignal(1);
  let composer!: HTMLDivElement;
  onMount(() => {
    composer.focus();
    const range = document.createRange();
    range.selectNodeContents(composer);
    range.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    setOpen(true);
    setTimeout(() => setRows(12), 100);
  });
  return (
    <main class="relative h-screen bg-page text-ink">
      <div
        ref={composer}
        contentEditable
        aria-label="Composer"
        class="absolute inset-x-4 h-10 rounded-full border border-edge px-4 leading-10"
        style={caretAtTop ? { top: '80px' } : { bottom: '80px' }}
      >
        /
      </div>
      <Show when={open()}>
        <Menu rows={rows()} />
      </Show>
    </main>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
