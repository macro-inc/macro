import { t } from '@app/lib/i18n';
import { prettyPrintHotkeyString } from '@core/hotkey/utils';
import { Hotkey } from '@ui';
import { For, Index, Show } from 'solid-js';
import type {
  HotkeyProfile,
  ProfileBinding,
  ProfileKey,
} from '../core/profiles';

function Key(props: { profileKey: ProfileKey }) {
  const steps = () =>
    typeof props.profileKey === 'string'
      ? [props.profileKey]
      : props.profileKey;
  return (
    <span class="inline-flex items-center gap-1">
      <Index each={steps()}>
        {(step, index) => (
          <>
            <Show when={index > 0}>
              <span class="text-xs text-ink-extra-muted">
                {t('shortcuts.sheetThen')}
              </span>
            </Show>
            <Hotkey shortcut={prettyPrintHotkeyString(step())} theme="muted" />
          </>
        )}
      </Index>
    </span>
  );
}

function BindingKeys(props: { binding: ProfileBinding<string> }) {
  // A numbered range (⌃1–9) reads as its ends.
  const keys = () =>
    'indexed' in props.binding.target && props.binding.keys.length > 2
      ? [props.binding.keys[0], props.binding.keys.at(-1)]
      : props.binding.keys;
  const separator = () =>
    'indexed' in props.binding.target ? '–' : t('shortcuts.sheetOr');
  return (
    <span class="flex shrink-0 flex-wrap items-center justify-end gap-1">
      <Index each={keys()}>
        {(key, index) => (
          <>
            <Show when={index > 0}>
              <span class="text-xs text-ink-extra-muted">{separator()}</span>
            </Show>
            <Show when={key()}>{(k) => <Key profileKey={k()} />}</Show>
          </>
        )}
      </Index>
    </span>
  );
}

/**
 * A profile's keys grouped by the vendor's sections, each marked with the
 * Macro shortcut it replaces, then the vendor keys Macro already shares.
 */
export function HotkeyProfileKeymap(props: { profile: HotkeyProfile<string> }) {
  const sections = () => [
    ...new Set(props.profile.bindings.map((binding) => binding.section())),
  ];
  return (
    <div class="flex flex-col gap-4">
      <For each={sections()}>
        {(section) => (
          <section aria-label={section}>
            <h3 class="mb-1 text-xs font-medium text-ink-muted">{section}</h3>
            <ul class="flex flex-col">
              <For
                each={props.profile.bindings.filter(
                  (binding) => binding.section() === section
                )}
              >
                {(binding) => (
                  <li class="flex min-h-8 items-center justify-between gap-4 text-sm">
                    <span class="flex min-w-0 flex-col">
                      <span class="text-ink">{binding.description()}</span>
                      <Show when={binding.replaces}>
                        {(replaces) => (
                          <span class="text-xs text-ink-extra-muted">
                            {t('hotkeyProfiles.replaces', {
                              shortcut: replaces()(),
                            })}
                          </span>
                        )}
                      </Show>
                    </span>
                    <BindingKeys binding={binding} />
                  </li>
                )}
              </For>
            </ul>
          </section>
        )}
      </For>
      <section aria-label={t('hotkeyProfiles.sameKeys')}>
        <h3 class="mb-2 text-xs font-medium text-ink-muted">
          {t('hotkeyProfiles.sameKeys')}
        </h3>
        <div class="flex flex-wrap gap-2">
          <For each={props.profile.sameKeys}>
            {(key) => <Key profileKey={key} />}
          </For>
        </div>
      </section>
    </div>
  );
}
