import { formatLocale, t } from '@app/lib/i18n';
import CheckIcon from '@icon/system/regular/check.svg';
import ClockCounterClockwise from '@icon/system/regular/clock-counter-clockwise.svg';
import { Dropdown } from '@ui';
import { For, type JSX, Show } from 'solid-js';

export type VersionRow = {
  number: number;
  message: string | undefined;
  /** Who published it; resolves names on its own. */
  author: JSX.Element;
  createdAt: string;
};

export function formatVersionTime(createdAt: string) {
  return new Intl.DateTimeFormat(formatLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(createdAt));
}

/** Version history, newest first; picking one shows it in the frame. */
export function VersionMenu(props: {
  versions: readonly VersionRow[];
  current: number;
  viewed: number;
  onView: (number: number) => void;
}) {
  return (
    <Dropdown>
      <Dropdown.Trigger
        variant="ghost"
        size="sm"
        aria-label={t('artifacts.versions')}
      >
        <ClockCounterClockwise class="size-4 shrink-0" />
        <span>{t('artifacts.version', { number: props.viewed })}</span>
      </Dropdown.Trigger>
      <Dropdown.Content class="max-h-96 min-w-72 max-w-96 overflow-y-auto">
        <Dropdown.Group>
          <Dropdown.RadioGroup
            value={String(props.viewed)}
            onChange={(value) => props.onView(Number(value))}
          >
            <For each={props.versions}>
              {(version) => (
                <Dropdown.RadioItem
                  value={String(version.number)}
                  closeOnSelect
                >
                  <span class="flex min-w-0 flex-1 flex-col">
                    <Dropdown.ItemLabel class="truncate">
                      {version.number === props.current
                        ? t('artifacts.versionCurrent', {
                            number: version.number,
                          })
                        : t('artifacts.version', { number: version.number })}
                    </Dropdown.ItemLabel>
                    <Dropdown.ItemDescription class="truncate text-xs text-ink-muted">
                      <Show when={version.message}>
                        {(message) => <>{message()} · </>}
                      </Show>
                      {version.author} · {formatVersionTime(version.createdAt)}
                    </Dropdown.ItemDescription>
                  </span>
                  <Dropdown.ItemIndicator>
                    <CheckIcon class="size-3.5 text-accent" />
                  </Dropdown.ItemIndicator>
                </Dropdown.RadioItem>
              )}
            </For>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
