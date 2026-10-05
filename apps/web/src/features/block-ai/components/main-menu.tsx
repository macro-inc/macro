/**
 * The menu at the left panel's top: File items (download the `.ai`, export
 * an artboard as PNG) and View toggles. Presentational.
 */

import List from '@phosphor/list.svg';
import { Button } from '@ui/components/Button';
import { createSignal, onCleanup, Show } from 'solid-js';
import { type MenuItem, MenuItems } from './status-bar';

export function MainMenu(props: { items: (MenuItem | 'divider')[] }) {
  const [open, setOpen] = createSignal(false);
  let root!: HTMLDivElement;
  const onDocumentDown = (e: PointerEvent) => {
    if (!root.contains(e.target as Node)) setOpen(false);
  };
  document.addEventListener('pointerdown', onDocumentDown);
  onCleanup(() => document.removeEventListener('pointerdown', onDocumentDown));
  return (
    <div ref={root} class="relative">
      <Button
        variant="ghost"
        size="icon-md"
        label="Main menu"
        tooltip="Main menu"
        aria-expanded={open()}
        data-testid="ai-main-menu"
        onClick={() => setOpen((o) => !o)}
      >
        <List />
      </Button>
      <Show when={open()}>
        <div class="absolute top-full left-0 z-50 mt-1 w-64 rounded-lg border border-edge-muted bg-menu p-1 text-xs shadow-lg">
          <MenuItems items={props.items} onDone={() => setOpen(false)} />
        </div>
      </Show>
    </div>
  );
}
