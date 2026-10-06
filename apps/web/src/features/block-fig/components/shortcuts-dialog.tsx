/** The keyboard shortcuts panel (Ctrl ⇧ ?). */

import XIcon from '@phosphor/x.svg';
import { For } from 'solid-js';
import { SHORTCUT_GROUPS } from '../core/shortcuts';

export function ShortcutsDialog(props: { mac: boolean; onClose: () => void }) {
  const cap = (k: string) => (k === 'mod' ? (props.mac ? '⌘' : 'Ctrl') : k);
  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      data-testid="fig-shortcuts"
      class="absolute inset-x-4 bottom-16 z-20 mx-auto max-h-[70%] max-w-3xl overflow-y-auto rounded-xl border border-edge-muted bg-menu p-4 text-ink text-xs shadow-xl"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div class="mb-3 flex items-center justify-between">
        <h2 class="font-semibold text-sm">Keyboard shortcuts</h2>
        <button
          type="button"
          aria-label="Close"
          class="rounded p-1 text-ink-muted hover:text-ink"
          onClick={props.onClose}
        >
          <XIcon class="size-3.5" />
        </button>
      </div>
      <div class="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
        <For each={SHORTCUT_GROUPS}>
          {(group) => (
            <div>
              <h3 class="mb-1.5 font-medium text-ink-muted">{group.title}</h3>
              <For each={group.items}>
                {(item) => (
                  <div class="flex items-center justify-between gap-2 py-0.5">
                    <span>{item.action}</span>
                    <span class="flex gap-0.5">
                      <For
                        each={
                          !props.mac && item.otherKeys
                            ? item.otherKeys
                            : item.keys
                        }
                      >
                        {(k) => (
                          <kbd class="rounded border border-edge-muted bg-inset px-1 font-sans">
                            {cap(k)}
                          </kbd>
                        )}
                      </For>
                    </span>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
