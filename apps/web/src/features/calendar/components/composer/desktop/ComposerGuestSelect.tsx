import { t } from '@app/lib/i18n';
import { ScopedPortal } from '@core/component/ScopedPortal';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { Popover } from '@kobalte/core/popover';
import { Button, Checkbox, Layer } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { composerGuestName } from '../../../core/composer-guests';
import { createComposerGuestSelection } from '../../../primitives/create-composer-guest-additions';
import { ComposerGuestPicker } from '../guests/ComposerGuestPicker';

/** Full-width guest selector for the desktop composer. */
export function ComposerGuestSelect() {
  const model = useCalendarComposer();
  const [open, setOpen] = createSignal(false);
  const {
    current: fixed,
    added,
    disabled,
    selection,
  } = createComposerGuestSelection(model.guests);
  const isOpen = () => open() && !disabled();

  return (
    <div class="flex min-w-0 flex-col gap-1">
      <Popover
        open={isOpen()}
        onOpenChange={(next) => setOpen(next && !disabled())}
        placement="bottom-start"
        gutter={4}
      >
        <Popover.Trigger
          as={Button}
          variant="value"
          finish="flat"
          size="select"
          fullWidth
          disabled={disabled()}
          aria-label={t('calendar.guests')}
        >
          <span class="min-w-0 flex-1 truncate text-left">
            {model.guests.selected.length
              ? model.guests.selected.map(composerGuestName).join(', ')
              : t('calendar.addGuests')}
          </span>
          <CaretDownIcon class="size-3.5" />
        </Popover.Trigger>
        <Show when={isOpen()}>
          <ScopedPortal scope="local">
            <Layer depth={3}>
              <Popover.Content
                class="menu-surface z-action-menu w-[var(--kb-popper-anchor-width)] min-w-64 max-w-[calc(100vw-2rem)] p-1.5 outline-none"
                on:keydown={(event: KeyboardEvent) => {
                  if (event.key !== 'Escape' || event.isComposing) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                }}
              >
                <Popover.Title class="sr-only">
                  {t('calendar.guests')}
                </Popover.Title>
                <Show when={fixed().length > 0}>
                  <div class="px-2 py-1 text-xs text-ink-muted">
                    {t('calendar.invitedGuests')}
                  </div>
                  <div
                    role="list"
                    aria-label={t('calendar.invitedGuests')}
                    class="flex flex-col gap-1 p-2"
                  >
                    <For each={fixed()}>
                      {(guest) => (
                        <div role="listitem">
                          <Checkbox checked disabled>
                            <Checkbox.Control />
                            <Checkbox.Label>
                              {composerGuestName(guest)}
                            </Checkbox.Label>
                          </Checkbox>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                <ComposerGuestPicker
                  options={model.guests.options}
                  selected={added()}
                  excluded={fixed()}
                  onChange={selection.replace}
                  onClose={() => setOpen(false)}
                />
              </Popover.Content>
            </Layer>
          </ScopedPortal>
        </Show>
      </Popover>
      <Show when={model.guests.guestListHidden}>
        <p class="text-xs text-ink-muted">{t('calendar.guestListHidden')}</p>
      </Show>
      <Show when={model.guests.readOnlyReason}>
        {(reason) => <p class="text-xs text-ink-muted">{reason()}</p>}
      </Show>
    </div>
  );
}
