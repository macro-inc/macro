import type {
  ShortcutSheet,
  ShortcutSheetEntry,
} from '@core/hotkey/getCommands';
import { prettyPrintHotkeyString } from '@core/hotkey/utils';
import {
  ActionDialogShell,
  Dialog,
  type DialogHandle,
  Hotkey,
  type ManagedDialogProps,
  openDialog,
} from '@ui';
import { For, Index, Show } from 'solid-js';

function ShortcutRow(props: { entry: ShortcutSheetEntry }) {
  return (
    <li class="flex min-h-8 items-center justify-between gap-4 text-sm">
      <span class="min-w-0 truncate text-ink">{props.entry.description}</span>
      {/* Screen readers get the keys as words; the glyphs are visual. */}
      <span class="sr-only">
        {props.entry.bindings
          .map((binding) => binding.join(' then '))
          .join(' or ')}
      </span>
      <span
        aria-hidden="true"
        class="flex shrink-0 flex-wrap items-center justify-end gap-1 text-xs text-ink-extra-muted"
      >
        <Index each={props.entry.bindings}>
          {(binding, bindingIndex) => (
            <>
              <Show when={bindingIndex > 0}>
                <span>or</span>
              </Show>
              <Index each={binding()}>
                {(key, keyIndex) => (
                  <>
                    <Show when={keyIndex > 0}>
                      <span>then</span>
                    </Show>
                    <Hotkey
                      shortcut={prettyPrintHotkeyString(key())}
                      theme="muted"
                    />
                  </>
                )}
              </Index>
            </>
          )}
        </Index>
      </span>
    </li>
  );
}

function ShortcutSection(props: {
  title: string;
  entries: ShortcutSheetEntry[];
}) {
  return (
    <Show when={props.entries.length > 0}>
      <section aria-label={props.title} class="min-w-0">
        <h3 class="mb-2 text-xs font-medium text-ink-muted">{props.title}</h3>
        <ul class="flex flex-col">
          <For each={props.entries}>
            {(entry) => <ShortcutRow entry={entry} />}
          </For>
        </ul>
      </section>
    </Show>
  );
}

function KeyboardShortcutsDialog(
  props: ManagedDialogProps & { sheet: ShortcutSheet }
) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      position="center"
      animate
      class="w-full max-w-[min(52rem,calc(100vw-16px))]"
    >
      <ActionDialogShell>
        <div class="shrink-0 border-b border-edge-divider px-5 py-4">
          <ActionDialogShell.Title>Keyboard shortcuts</ActionDialogShell.Title>
        </div>
        {/* Focusable so the keyboard can scroll a long sheet. */}
        <div
          tabIndex={0}
          aria-label="Shortcuts"
          class="grid min-h-0 gap-x-8 gap-y-6 overflow-y-auto p-5 outline-none focus-visible:ring focus-visible:ring-inset focus-visible:ring-accent sm:grid-cols-2"
        >
          <ShortcutSection title="This view" entries={props.sheet.view} />
          <ShortcutSection title="Everywhere" entries={props.sheet.app} />
        </div>
      </ActionDialogShell>
    </Dialog>
  );
}

let open: DialogHandle | undefined;

/** Shows the shortcuts that were available when the sheet was read, or
 * closes the sheet when it is already showing. */
export function toggleKeyboardShortcuts(sheet: ShortcutSheet) {
  if (open?.isOpen()) {
    open.close();
    return;
  }
  open = openDialog(
    KeyboardShortcutsDialog,
    { sheet },
    { key: 'keyboard-shortcuts' }
  );
}
