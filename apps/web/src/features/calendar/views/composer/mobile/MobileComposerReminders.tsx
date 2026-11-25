import { t } from '@app/lib/i18n';
import BellIcon from '@icon/system/regular/bell-simple.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { PhoneMenuChoice } from '../../../components/composer/phone-menu/PhoneMenuChoice';
import { PhoneMenuPage } from '../../../components/composer/phone-menu/PhoneMenuPage';
import { PhoneMenuTrigger } from '../../../components/composer/phone-menu/PhoneMenuTrigger';
import { usePhoneComposerMenu } from '../../../context/phone-composer-menu-context';
import type { ComposerReminderOptions } from '../../../primitives/create-composer-reminders';
import { createComposerReminders } from '../../../primitives/create-composer-reminders';
import { formatReminderOffset } from '../../../utils/event-reminders';

export function MobileComposerReminders(props: ComposerReminderOptions) {
  const menus = usePhoneComposerMenu();
  const reminders = createComposerReminders(props);
  const [editing, setEditing] = createSignal<number>();
  const selected = () => {
    const index = editing();
    return index === undefined ? undefined : props.minutes[index];
  };
  const choices = () => (
    <For each={reminders.offsets()}>
      {(offset) => (
        <PhoneMenuChoice
          label={formatReminderOffset(offset)}
          selected={offset === selected()}
          disabled={props.minutes.includes(offset) && offset !== selected()}
          onChoose={() => {
            const index = editing();
            if (index === undefined) reminders.add(offset);
            else reminders.replace(index, String(offset));
            menus.close();
          }}
        />
      )}
    </For>
  );
  return (
    <>
      <For each={props.minutes}>
        {(minutes, index) => (
          <div class="flex min-h-11 items-center pr-1">
            <div class="min-w-0 flex-1">
              <PhoneMenuTrigger
                menu="reminders"
                title={formatReminderOffset(minutes)}
                value={formatReminderOffset(minutes)}
                disabled={props.disabled}
                icon={
                  <Show when={index() === 0}>
                    <BellIcon class="size-4" />
                  </Show>
                }
                onOpen={() => setEditing(index())}
              />
            </div>
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label={t('calendar.removeNotification', {
                offset: formatReminderOffset(minutes),
              })}
              disabled={props.disabled}
              onClick={() => reminders.remove(index())}
            >
              <CloseIcon class="size-4" />
            </Button>
          </div>
        )}
      </For>
      <PhoneMenuTrigger
        menu="reminders"
        title={t('calendar.addReminder')}
        value={t('calendar.addReminder')}
        icon={
          <Show when={props.minutes.length === 0}>
            <BellIcon class="size-4" />
          </Show>
        }
        placeholder
        disabled={props.disabled || !props.canAdd}
        onOpen={() => setEditing(undefined)}
      />
      <Show when={menus.when.state.active === 'reminders' && !props.disabled}>
        <PhoneMenuPage
          title={
            editing() === undefined
              ? t('calendar.addReminder')
              : t('calendar.reminder')
          }
        >
          {choices()}
        </PhoneMenuPage>
      </Show>
      <Show when={props.preservedCount > 0}>
        <p class="px-3 pb-2 text-xs text-ink-muted">
          {t('calendar.otherNotificationsPreserved', {
            count: props.preservedCount,
          })}
        </p>
      </Show>
    </>
  );
}
