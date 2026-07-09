import { useChannelsContext } from '@core/context/channels';
import { MaybeEntityRow, MultiSelectCheckbox } from '@entity';
import type { BaseListEntityProps } from '@entity/composed/list-entity/shared';
import { cn } from '@ui';
import { createMemo, Show } from 'solid-js';
import { InboxCardLayout, toInboxCardDisplayItem } from './inbox-card-layouts';
import { scopeThreadNotifications } from './utils';

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
      {/* Select checkbox lives in the gutter reserved by the card's `pl-9`. */}
      <Show when={!props.hideCheckbox}>
        <div
          class={cn(
            'absolute left-1 top-2.5 z-10 size-8 place-items-center',
            props.checked ? 'grid' : 'hidden group-hover/inbox-item:grid'
          )}
        >
          <MultiSelectCheckbox
            checked={props.checked}
            onChecked={props.onChecked}
            showBorder
          />
        </div>
      </Show>
    </div>
  );
}
