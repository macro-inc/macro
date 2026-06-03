import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import type { ChannelEntity } from '@entity';
import ClockIcon from '@phosphor/clock.svg';
import EmailIcon from '@phosphor/envelope.svg';
import UsersIcon from '@phosphor/users.svg';
import { cn } from '@ui';
import { createEffect, Show } from 'solid-js';
import type { MentionItem } from '../../../../utils/mentionsUtils';
import { isBotMentionItem } from '../utils/botMention';
import {
  getBlockNameFromEntity,
  getMentionItemName,
} from '../utils/entityUtils';

export function MentionsMenuItem(props: {
  item: MentionItem;
  index: number;
  selected: boolean;
  itemAction: (item: MentionItem) => void;
  setIndex: (index: number) => void;
  setOpen: (open: boolean) => void;
  /** When true, disables the internal scrollIntoView behavior (used when list is virtualized) */
  disableScrollIntoView?: boolean;
}) {
  let itemRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (props.selected && itemRef && !props.disableScrollIntoView) {
      itemRef.scrollIntoView({ block: 'nearest' });
    }
  });

  const name = () => getMentionItemName(props.item);

  const icon = () => {
    switch (props.item.kind) {
      case 'user':
        return <UserIcon id={props.item.id} size="sm" isDeleted={false} />;

      case 'group':
        return <UsersIcon class="size-4 text-ink-muted" />;

      case 'date':
        return <ClockIcon class="size-4 text-ink-muted" />;

      case 'entity':
        if (props.item.bucket === 'email') {
          return <EmailIcon class="size-4 text-ink-muted" />;
        }
        if (props.item.bucket === 'channel' || props.item.bucket === 'dm') {
          const entity = props.item.data as ChannelEntity;
          return (
            <EntityIcon
              size="xs"
              targetType={entity.channelType || 'channel'}
            />
          );
        }
        return (
          <EntityIcon
            targetType={getBlockNameFromEntity(props.item)}
            size="xs"
          />
        );
    }
  };

  return (
    <div
      ref={itemRef}
      on:mouseup={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      on:mousedown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      on:click={(e) => {
        props.itemAction(props.item);
        props.setOpen(false);
        e.stopPropagation();
      }}
      on:mousemove={() => props.setIndex(props.index)}
      class={cn('group flex items-center p-1.5 mx-1.5 rounded-md', {
        'bg-ink/5': props.selected,
      })}
    >
      <div class="mr-2 flex items-center">{icon()}</div>
      <div class="flex min-w-0 grow items-center gap-2">
        <span
          class="ph-no-capture min-w-0 max-w-full overflow-hidden text-nowrap text-ink text-xs sm:text-sm font-medium"
          style={{ 'text-overflow': 'ellipsis' }}
        >
          {name()}
        </span>
        <Show when={isBotMentionItem(props.item)}>
          <span class="inline-flex shrink-0 items-center rounded-sm bg-hover px-1.5 py-0.5 text-[10px] font-medium leading-none text-ink-muted">
            Agent
          </span>
        </Show>
      </div>
    </div>
  );
}
