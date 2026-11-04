import { t } from '@app/lib/i18n';
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

function ShortcutRow(props: {
  entry: ShortcutSheetEntry;
  /** Show which profile the keys belong to. */
  showProfile?: boolean;
}) {
  return (
    <li class="flex min-h-8 items-center justify-between gap-4 text-sm">
      <span class="flex min-w-0 items-center gap-2">
        {/* Wraps rather than truncates: a row of many keys leaves it little room. */}
        <span class="min-w-0 text-ink">{props.entry.description}</span>
        <Show when={props.showProfile && props.entry.profileLabel}>
          {(label) => (
            <span class="shrink-0 text-xs text-ink-extra-muted">{label()}</span>
          )}
        </Show>
      </span>
      {/* Screen readers get the keys as words; the glyphs are visual. */}
      <span class="sr-only">
        {props.entry.bindings
          .map((binding) => binding.join(` ${t('shortcuts.sheetThen')} `))
          .join(` ${t('shortcuts.sheetOr')} `)}
      </span>
      <span
        aria-hidden="true"
        class="flex max-w-[60%] flex-wrap items-center justify-end gap-1 text-xs text-ink-extra-muted"
      >
        <Index each={props.entry.bindings}>
          {(binding, bindingIndex) => (
            <>
              <Show when={bindingIndex > 0}>
                <span>{t('shortcuts.sheetOr')}</span>
              </Show>
              <Index each={binding()}>
                {(key, keyIndex) => (
                  <>
                    <Show when={keyIndex > 0}>
                      <span>{t('shortcuts.sheetThen')}</span>
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
  showProfiles?: boolean;
}) {
  return (
    <Show when={props.entries.length > 0}>
      <section aria-label={props.title} class="min-w-0">
        <h3 class="mb-2 text-xs font-medium text-ink-muted">{props.title}</h3>
        <ul class="flex flex-col">
          <For each={props.entries}>
            {(entry) => (
              <ShortcutRow entry={entry} showProfile={props.showProfiles} />
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}

/** Macro's shortcuts a hotkey profile took over, one section per profile. */
function ReplacedSections(props: { entries: ShortcutSheetEntry[] }) {
  const profiles = () => [
    ...new Set(props.entries.map((entry) => entry.profileLabel ?? '')),
  ];
  return (
    <For each={profiles()}>
      {(profile) => (
        <ShortcutSection
          title={t('shortcuts.sheetReplacedBy', { profile })}
          entries={props.entries.filter(
            (entry) => (entry.profileLabel ?? '') === profile
          )}
        />
      )}
    </For>
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
          <ActionDialogShell.Title>
            {t('shortcuts.sheetTitle')}
          </ActionDialogShell.Title>
        </div>
        {/* Focusable so the keyboard can scroll a long sheet. */}
        <div
          tabIndex={0}
          aria-label={t('shortcuts.sheetListLabel')}
          class="grid min-h-0 gap-x-8 gap-y-6 overflow-y-auto p-5 outline-none focus-visible:ring focus-visible:ring-inset focus-visible:ring-accent sm:grid-cols-2"
        >
          <ShortcutSection
            title={t('shortcuts.sheetThisView')}
            entries={props.sheet.view}
            showProfiles
          />
          <ShortcutSection
            title={t('shortcuts.sheetEverywhere')}
            entries={props.sheet.app}
          />
          <ReplacedSections entries={props.sheet.replaced} />
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
