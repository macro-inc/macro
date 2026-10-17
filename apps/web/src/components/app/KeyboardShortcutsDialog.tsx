import type {
  ShortcutSheet,
  ShortcutSheetEntry,
} from '@core/hotkey/getCommands';
import { prettyPrintHotkeyString } from '@core/hotkey/utils';
import {
  ActionDialogShell,
  Dialog,
  Hotkey,
  type ManagedDialogProps,
  openDialog,
} from '@ui';
import { For, Index, Show } from 'solid-js';

function ShortcutRow(props: { entry: ShortcutSheetEntry }) {
  return (
    <li class="flex min-h-8 items-center justify-between gap-4 text-sm">
      <span class="min-w-0 truncate text-ink">{props.entry.description}</span>
      <span class="flex shrink-0 flex-wrap items-center justify-end gap-1 text-xs text-ink-extra-muted">
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
        <ActionDialogShell.Body class="grid gap-x-8 gap-y-6 sm:grid-cols-2">
          <ShortcutSection title="This view" entries={props.sheet.view} />
          <ShortcutSection title="Everywhere" entries={props.sheet.app} />
        </ActionDialogShell.Body>
      </ActionDialogShell>
    </Dialog>
  );
}

/** Shows the shortcuts that were available when the sheet was read. */
export function openKeyboardShortcuts(sheet: ShortcutSheet) {
  openDialog(KeyboardShortcutsDialog, { sheet }, { key: 'keyboard-shortcuts' });
}
