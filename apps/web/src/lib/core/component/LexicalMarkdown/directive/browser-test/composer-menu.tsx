import '@app/index.css';
import { createSignal, For, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { floatWithSelection } from '../floatWithSelection';

const PANEL_DECORATION_HEIGHT = 18;
const MAX_CONTENT_HEIGHT = 256;

function Menu(props: { rows: number; stealFocus?: boolean }) {
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
        <Show when={props.stealFocus}>
          <input data-testid="search" type="search" aria-label="Search" />
        </Show>
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
  const stealFocus =
    new URLSearchParams(location.search).get('stealFocus') === '1';
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
    if (stealFocus) {
      // GIF picker's search field takes focus after open; the live Range
      // from getSelection() would otherwise follow it and hide() the menu.
      setTimeout(() => {
        document
          .querySelector<HTMLInputElement>('[data-testid=search]')
          ?.focus();
      }, 50);
    }
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
        <Menu rows={rows()} stealFocus={stealFocus} />
      </Show>
    </main>
  );
}

// A height-capped editor that scrolls, as the channel composer does, with a
// selection that runs past its visible bottom.
function ClippedSelectionFixture() {
  const clip = new URLSearchParams(location.search).get('clip') !== '0';
  const [open, setOpen] = createSignal(false);
  let editor!: HTMLDivElement;
  onMount(() => {
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    setOpen(true);
  });
  return (
    <main class="relative h-screen bg-page p-4 text-ink">
      <div
        data-testid="editor-shell"
        class="max-h-[160px] overflow-y-auto rounded-xl border border-edge p-2"
      >
        <div ref={editor} contentEditable aria-label="Editor">
          <For each={Array.from({ length: 30 }, (_, i) => i + 1)}>
            {(line) => <p>Line {line} of a long message being edited.</p>}
          </For>
        </div>
      </div>
      <Show when={open()}>
        <div
          data-testid="format-menu"
          class="h-10 w-48 rounded-lg menu-surface"
          ref={(el) =>
            floatWithSelection(el, () => ({
              selection: document.getSelection(),
              reactiveOnContainer: editor,
              clipToVisible: clip,
            }))
          }
        />
      </Show>
    </main>
  );
}

const isClippedSelection =
  new URLSearchParams(location.search).get('fixture') === 'clipped-selection';

render(
  () => (isClippedSelection ? <ClippedSelectionFixture /> : <Fixture />),
  document.getElementById('root')!
);
