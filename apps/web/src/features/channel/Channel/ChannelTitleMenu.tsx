import { toSingleEntityActionListState } from '@app/features/next-soup/actions';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { SoupEntityActionsDropdown } from '@app/features/soup/SoupEntityActionsDropdown';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import DotsThreeIcon from '@phosphor/dots-three.svg';
import { Show } from 'solid-js';
import { CHANNEL_ACTION_VIEW_CONTEXT } from './channel-actions';
import { useChannelEntity } from './channel-entity';

/**
 * The conversation's entity actions behind the same ellipsis a document's
 * title menu uses. The actions match the channel's row in the rail, so
 * favoriting, muting or renaming a conversation does not depend on finding
 * that row.
 *
 * Owned by the channel top bar rather than by each of its hosts: the menu
 * resolves the conversation from its id, so a surface that opens a channel
 * cannot forget to offer it.
 */
export function ChannelTitleMenu(props: { channelId: string }) {
  const notificationSource = useGlobalNotificationSource();
  const channel = useChannelEntity(() => props.channelId);
  const entity = () => {
    const resolved = channel();
    return resolved && withEntityNotifications(resolved, notificationSource);
  };
  const list = toSingleEntityActionListState(entity);

  return (
    <Show when={entity()}>
      {(current) => (
        <SoupEntityActionsDropdown
          entity={current()}
          list={list}
          viewContext={CHANNEL_ACTION_VIEW_CONTEXT}
          triggerProps={{ size: 'icon-sm', label: 'Channel actions' }}
        >
          <DotsThreeIcon />
        </SoupEntityActionsDropdown>
      )}
    </Show>
  );
}
