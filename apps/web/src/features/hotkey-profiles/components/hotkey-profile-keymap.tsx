import { SearchBar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { prettyPrintHotkeyString } from '@core/hotkey/utils';
import { getNormalizedKeyString } from '@ui/components/Hotkey';
import { createMemo, createSignal, For, Index, Show } from 'solid-js';
import type { HotkeyProfile, ProfileKey } from '../core/profiles';

type KeymapRow = {
  section: () => string;
  keys: readonly ProfileKey[];
  description: string;
  replaces?: string;
  /** A numbered run of keys (⌃1–9), shown as one range. */
  range: boolean;
};

/** One cap per key, modifiers first: ⌘ ⇧ A. */
function KeyCaps(props: { hotkey: string }) {
  return (
    <For each={props.hotkey.split('+')}>
      {(part) => (
        <kbd class="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-edge-muted bg-ink/4 px-1 font-sans text-[11px] leading-none font-medium text-ink-muted">
          {getNormalizedKeyString({ shortcut: part })}
        </kbd>
      )}
    </For>
  );
}

function SequenceCaps(props: { profileKey: ProfileKey }) {
  const steps = () =>
    typeof props.profileKey === 'string'
      ? [props.profileKey]
      : props.profileKey;
  return (
    <Index each={steps()}>
      {(step, index) => (
        <>
          <Show when={index > 0}>
            <span class="px-0.5 text-xs text-ink-extra-muted">
              {t('shortcuts.sheetThen')}
            </span>
          </Show>
          <KeyCaps hotkey={prettyPrintHotkeyString(step())} />
        </>
      )}
    </Index>
  );
}

function RowKeys(props: { row: KeymapRow }) {
  // ⌃1 … ⌃9 reads as ⌃ 1–9: the first key's modifiers, then the digits.
  const range = () => {
    const first = props.row.keys[0];
    const last = props.row.keys.at(-1);
    if (typeof first !== 'string' || typeof last !== 'string') return;
    const parts = first.split('+');
    parts[parts.length - 1] += `–${last.split('+').at(-1)}`;
    return parts.join('+');
  };
  return (
    <span class="flex shrink-0 flex-wrap items-center justify-end gap-1">
      <Show
        when={props.row.range && range()}
        fallback={
          <Index each={props.row.keys}>
            {(key, index) => (
              <>
                <Show when={index > 0}>
                  <span class="px-0.5 text-xs text-ink-extra-muted">
                    {t('shortcuts.sheetOr')}
                  </span>
                </Show>
                <SequenceCaps profileKey={key()} />
              </>
            )}
          </Index>
        }
      >
        {(hotkey) => <KeyCaps hotkey={hotkey()} />}
      </Show>
    </span>
  );
}

/**
 * Every vendor key that works in Macro, grouped like the vendor's own
 * shortcut list, with the Macro shortcut each one replaces.
 */
export function HotkeyProfileKeymap(props: { profile: HotkeyProfile<string> }) {
  const [query, setQuery] = createSignal('');

  const sections = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase();
    const rows: KeymapRow[] = [
      ...props.profile.bindings.map((binding) => ({
        section: binding.section,
        keys: binding.keys,
        description: binding.description(),
        replaces:
          binding.replaces &&
          t('hotkeyProfiles.replaces', { shortcut: binding.replaces() }),
        range: 'indexed' in binding.target,
      })),
      ...props.profile.sameKeys.map((same) => ({
        section: same.section,
        keys: same.keys,
        description: same.description(),
        range: false,
      })),
    ];
    return props.profile.sections
      .map((section) => ({
        title: section(),
        rows: rows.filter((row) => row.section === section),
      }))
      .map((section) => ({
        ...section,
        rows: section.title.toLocaleLowerCase().includes(needle)
          ? section.rows
          : section.rows.filter((row) =>
              [row.description, row.replaces ?? ''].some((text) =>
                text.toLocaleLowerCase().includes(needle)
              )
            ),
      }))
      .filter((section) => section.rows.length > 0);
  });

  return (
    <div class="@container flex flex-col gap-4">
      <SearchBar
        label={t('hotkeyProfiles.searchKeymap')}
        placeholder={t('hotkeyProfiles.searchKeymap')}
        autocomplete="off"
        size="sm"
        value={query()}
        onValueChange={setQuery}
        onEscape={() => setQuery('')}
        class="@2xl:max-w-72"
      />
      <Show
        when={sections().length > 0}
        fallback={
          <p class="py-6 text-center text-sm text-ink-muted">
            {t('hotkeyProfiles.noMatchingShortcuts')}
          </p>
        }
      >
        <div class="gap-x-10 @2xl:columns-2">
          <For each={sections()}>
            {(section) => (
              <section
                aria-label={section.title}
                class="break-inside-avoid pb-5"
              >
                <h3 class="pb-1 text-xs font-medium text-ink-muted">
                  {section.title}
                </h3>
                <ul>
                  <For each={section.rows}>
                    {(row) => (
                      <li class="flex items-start justify-between gap-4 py-1.5">
                        <span class="flex min-w-0 flex-col">
                          <span class="text-sm text-ink">
                            {row.description}
                          </span>
                          <Show when={row.replaces}>
                            <span class="text-xs text-ink-extra-muted">
                              {row.replaces}
                            </span>
                          </Show>
                        </span>
                        <RowKeys row={row} />
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
