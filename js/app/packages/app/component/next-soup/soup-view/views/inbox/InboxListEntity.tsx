import { useSoup } from '@app/component/next-soup/soup-context';
import { useChannelsContext } from '@core/context/channels';
import type { BaseListEntityProps } from '@entity/composed/list-entity/shared';
import { createMemo } from 'solid-js';
import { InboxCardLayout, toInboxCardDisplayItem } from './inbox-card-layouts';
import { useInboxExpansion } from './inbox-expansion';
import { scopeThreadNotifications } from './utils';

/**
 * Inbox-specific list entity: renders the notification `InboxCardLayout` for a
 * soup row. Soup owns the query, virtualization, selection and preview, so this
 * adapter only maps the row into the card's display item and derives `selected`
 * from the soup preview target.
 *
 * Expand/collapse of thread sub-items is read from the view-level
 * `InboxExpansionProvider` when present (so it survives the row scrolling out of
 * view); without a provider the card falls back to its own local state.
 */
export function InboxListEntity(props: BaseListEntityProps) {
  const soup = useSoup();
  const expansion = useInboxExpansion();
  const channels = useChannelsContext();

  // A channel_thread soup entity comes back with a generic name ("Channel
  // thread"), so resolve the real channel name for the row's location label.
  const entity = createMemo(() => {
    const scoped = scopeThreadNotifications(props.entity);
    if (scoped.type !== 'channel_thread') return scoped;
    const name = channels.channelsById()[scoped.channelId]?.name;
    return name ? { ...scoped, name } : scoped;
  });

  const item = createMemo(() => toInboxCardDisplayItem(entity()));
  const selected = () => soup.previewEntity() === props.entity.id;

  return (
    <div class="mx-1" ref={props.ref} onMouseMove={props.onMouseMove}>
      <InboxCardLayout
        item={item()}
        selected={selected()}
        highlighted={props.highlighted}
        onClick={props.onClick}
        expanded={expansion ? expansion.isExpanded(props.entity.id) : undefined}
        onToggleExpanded={
          expansion ? () => expansion.toggle(props.entity.id) : undefined
        }
      />
    </div>
  );
}
