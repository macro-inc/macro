import { t } from '@app/lib/i18n';
import { ScopedPortal } from '@core/component/ScopedPortal';
import PlusIcon from '@icon/system/regular/plus.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Popover } from '@kobalte/core/popover';
import { Button, Layer } from '@ui';
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import {
  composerGuestKey,
  composerGuestName,
} from '../../../core/composer-guests';
import { createComposerGuestAdditions } from '../../../primitives/create-composer-guest-additions';
import { ComposerGuestChip } from './ComposerGuestChip';
import { ComposerGuestCollection } from './ComposerGuestCollection';
import { ComposerGuestPicker } from './ComposerGuestPicker';

export function ComposerGuests() {
  const model = useCalendarComposer();
  const [open, setOpen] = createSignal(false);
  const fixed = () => model.guests.currentGuests ?? [];
  const added = () =>
    model.guests.selected.filter(
      (guest) =>
        !fixed().some(
          (current) => composerGuestKey(current) === composerGuestKey(guest)
        )
    );
  const disabled = () => model.guests.disabled || model.guests.readOnly;
  const selection = createComposerGuestAdditions({
    current: fixed,
    added,
    disabled,
    onChange: (guests) => model.guests.onChange([...fixed(), ...guests]),
  });
  const isOpen = () => open() && !disabled();
  return (
    <div class="flex flex-col gap-1">
      <Popover
        open={isOpen()}
        onOpenChange={(next) => setOpen(next && !disabled())}
        placement="bottom-start"
        gutter={4}
      >
        <div class="flex min-w-0 flex-wrap items-center gap-1">
          <For each={model.guests.selected}>
            {(guest) => (
              <ComposerGuestChip guest={guest}>
                <Show
                  when={!model.guests.readOnly && selection.canRemove(guest)}
                >
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('calendar.removeGuest', {
                      name: composerGuestName(guest),
                    })}
                    disabled={model.guests.disabled}
                    onClick={() => selection.remove(guest)}
                  >
                    <CloseIcon class="size-3" />
                  </Button>
                </Show>
              </ComposerGuestChip>
            )}
          </For>
          <Show when={!model.guests.readOnly}>
            <Popover.Trigger
              as={Button}
              variant="ghost"
              size="sm"
              disabled={model.guests.disabled}
              aria-label={t('calendar.addGuests')}
            >
              <PlusIcon class="size-3.5" />
              {model.guests.selected.length === 0
                ? t('calendar.addGuests')
                : undefined}
            </Popover.Trigger>
          </Show>
        </div>
        <Show when={isOpen()}>
          <ScopedPortal scope="local">
            <Layer depth={3}>
              <Popover.Content class="menu-surface z-action-menu w-80 max-w-[calc(100vw-2rem)] p-1.5 outline-none">
                <Popover.Title class="sr-only">
                  {t('calendar.guests')}
                </Popover.Title>
                <Switch>
                  <Match when={model.guests.currentGuests !== undefined}>
                    <ComposerGuestCollection
                      options={model.guests.options}
                      current={fixed()}
                      added={added()}
                      onAddedChange={selection.replace}
                      onClose={() => setOpen(false)}
                      disabled={disabled()}
                    />
                  </Match>
                  <Match when={model.guests.currentGuests === undefined}>
                    <ComposerGuestPicker
                      options={model.guests.options}
                      selected={model.guests.selected}
                      onChange={selection.replace}
                      onClose={() => setOpen(false)}
                    />
                  </Match>
                </Switch>
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
