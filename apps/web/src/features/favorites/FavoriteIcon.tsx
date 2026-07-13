import {
  favoriteIconType,
  useFavoriteDmRecipientId,
} from '@app/util/favorites';
import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { Show } from 'solid-js';

/**
 * Icon for a favorite. DM channel favorites show the other participant's
 * avatar, matching how channel rows render elsewhere in the sidebar;
 * everything else shows its entity icon.
 *
 * The favorite's identity must be stable for the component's lifetime
 * (favorites lists key rows by entity, so it is).
 */
export function FavoriteIcon(props: { favorite: Favorite; class?: string }) {
  const dmRecipientId = useFavoriteDmRecipientId(props.favorite);
  return (
    <Show
      when={dmRecipientId()}
      fallback={
        <EntityIcon
          size="xs"
          targetType={favoriteIconType(props.favorite)}
          class={props.class}
        />
      }
    >
      {(recipientId) => (
        <UserIcon
          id={recipientId()}
          size="sm"
          suppressClick
          showTooltip={false}
          class={props.class}
        />
      )}
    </Show>
  );
}
