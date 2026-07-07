import { useChannelsContext } from '@core/context/channels';
import { MaybeEntityRow, MultiSelectCheckbox } from '@entity';
import type { BaseListEntityProps } from '@entity/composed/list-entity/shared';
import { createMemo } from 'solid-js';
import { InboxCardLayout, toInboxCardDisplayItem } from './inbox-card-layouts';
import { scopeThreadNotifications } from './utils';
import { cn } from '@ui';

/**
 * Inbox-specific list entity: renders the notification `InboxCardLayout` for a
 * soup row. Soup owns the query, virtualization, selection and preview, so this
 * adapter only maps the row into the card's display item and derives `selected`
 * from the focused row (which is what the preview shows).
 *
 */
export function InboxListEntity(props: BaseListEntityProps) {
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

  return (
    <div
      class="group/inbox-item relative mx-2"
      ref={props.ref}
      onMouseMove={props.onMouseMove}
    >
      <MaybeEntityRow entityId={props.entity.id} config={props.entityRowConfig}>
        <InboxCardLayout
          item={item()}
          selected={props.checked}
          highlighted={props.highlighted}
          onClick={props.onClick}
        />
      </MaybeEntityRow>
      <div
        class={cn(
          'hidden absolute right-2 bottom-2 z-10 group-hover/inbox-item:flex items-center justify-center bg-surface overflow-hidden',
          props.checked && 'flex'
        )}
      >
        <MultiSelectCheckbox
          checked={props.checked}
          onChecked={props.onChecked}
          showBorder
        />
      </div>
    </div>
  );
}
