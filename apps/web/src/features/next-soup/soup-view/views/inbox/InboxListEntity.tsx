import '@entity/composed/ListEntity.css';
import { useChannelsContext } from '@core/context/channels';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { MaybeEntityRow, MultiSelectCheckbox, UnreadIndicator } from '@entity';
import { SOUP_ROW_CLASS } from '@entity/composed/list-entity/row-geometry';
import {
  type BaseListEntityProps,
  InboxDivider,
} from '@entity/composed/list-entity/shared';
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
type InboxListEntityProps = BaseListEntityProps & {
  /** Classes applied to the outer list-row wrapper. */
  class?: string;
  /** Classes applied to the rendered Inbox card. */
  cardClass?: string;
  focusable?: boolean;
  occurrenceKey?: string;
};

export function InboxListEntity(props: InboxListEntityProps) {
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
      // `soup-list-entity` scopes the --soup-inbox-* geometry vars (defined in
      // ListEntity.css) that the mobile narrow-inbox restyle of InboxCard
      // reads, and opts the row into the shared touch-press highlight. On
      // mobile the row is full-bleed with a hairline divider, like
      // NarrowInboxLayout.
      class={cn(
        'group/inbox-item soup-list-entity relative mx-(--soup-row-gutter)',
        SOUP_ROW_CLASS.card,
        props.class
      )}
      ref={props.ref}
      onMouseMove={props.onMouseMove}
    >
      <MaybeEntityRow
        entityId={props.occurrenceKey ?? props.entity.id}
        config={props.entityRowConfig}
      >
        <InboxCardLayout
          class={props.cardClass}
          item={item()}
          selected={props.checked}
          highlighted={props.highlighted}
          focusable={props.focusable}
          onClick={props.onClick}
        />
      </MaybeEntityRow>
      <Show when={isTouchDevice() && !props.isLastInGroup}>
        <InboxDivider />
      </Show>
      {/* Select checkbox lives in the gutter the card reserves as its
          `--soup-row-padding-l` left padding;
          mobile has no gutter — the rail shows the unread dot instead. */}
      <Show when={!isTouchDevice() && !props.hideCheckbox}>
        <div class="group/select-control absolute left-1 top-2.5 z-10 grid size-8 place-items-center">
          <Show when={!props.checked}>
            <div
              aria-hidden="true"
              class={cn(
                'pointer-events-none grid size-4 place-items-center rounded-xs group-hover/select-control:hidden',
                !item().unread && 'border border-edge'
              )}
            >
              <UnreadIndicator active={item().unread} />
            </div>
          </Show>
          <div
            class={cn(
              'absolute inset-0 place-items-center',
              props.checked ? 'grid' : 'hidden group-hover/select-control:grid'
            )}
          >
            <MultiSelectCheckbox
              checked={props.checked}
              onChecked={props.onChecked}
              showBorder
            />
          </div>
        </div>
      </Show>
    </div>
  );
}
