import { UserIcon } from '@core/component/UserIcon';
import { Badge } from '@ui';
import type { ParentProps } from 'solid-js';
import { composerGuestName } from '../../../core/composer-guests';
import type { SelectedEventEditorGuest } from '../event-form-model';

export function ComposerGuestChip(
  props: ParentProps<{ guest: SelectedEventEditorGuest }>
) {
  return (
    <Badge variant="secondary" size="sm" class="min-h-7 max-w-full gap-1.5">
      <span class="size-5 shrink-0">
        <UserIcon
          id={props.guest.id}
          name={composerGuestName(props.guest)}
          size="fill"
          suppressClick
          showTooltip={false}
        />
      </span>
      <span class="min-w-0 truncate">{composerGuestName(props.guest)}</span>
      {props.children}
    </Badge>
  );
}
