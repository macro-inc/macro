import { t } from '@app/lib/i18n';
import { SheetRow } from '@components/app/mobile/SheetRow';
import { UserIcon } from '@core/component/UserIcon';
import UsersIcon from '@icon/system/regular/users.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import type { SelectedEventEditorGuest } from '../../../components/composer/event-form-model';
import { composerGuestName } from '../../../core/composer-guests';

export function MobileComposerGuestRow(props: {
  guest: SelectedEventEditorGuest;
  showIcon: boolean;
  removable: boolean;
  onRemove: () => void;
}) {
  return (
    <SheetRow
      icon={
        <Show when={props.showIcon}>
          <UsersIcon class="size-4" />
        </Show>
      }
    >
      <div class="flex min-h-11 min-w-0 items-center gap-3">
        <span class="size-6 shrink-0">
          <UserIcon
            id={props.guest.id}
            name={composerGuestName(props.guest)}
            size="fill"
            suppressClick
            showTooltip={false}
          />
        </span>
        <span class="min-w-0 flex-1 truncate">
          {composerGuestName(props.guest)}
        </span>
        <Show when={props.removable}>
          <Button
            variant="ghost"
            size="icon-lg"
            class="shrink-0"
            aria-label={t('calendar.removeGuest', {
              name: composerGuestName(props.guest),
            })}
            onClick={props.onRemove}
          >
            <CloseIcon class="size-4" />
          </Button>
        </Show>
      </div>
    </SheetRow>
  );
}
