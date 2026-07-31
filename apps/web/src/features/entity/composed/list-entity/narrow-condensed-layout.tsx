import { cn } from '@ui';
import { Show } from 'solid-js';
import { MultiSelectCheckbox } from '../../components/MultiSelectCheckbox';
import { UnreadIndicator } from '../../components/UnreadIndicator';
import { Entity } from '../../entity';
import { isChannelEntity } from '../../types/entity';
import { ChannelJoinButton } from './channel';
import type { LayoutProps } from './shared';

/** Condensed row used for maximum density. */
export function NarrowCondensedLayout(props: LayoutProps) {
  return (
    <Entity.Layout
      class="w-full gap-x-2 items-center pr-2 grid text-sm"
      style={{
        'grid-template-columns': 'auto 1fr',
        'grid-template-rows': '36px',
        'grid-template-areas': '"indicator title"',
      }}
    >
      <Entity.Slot placement="indicator" class="relative self-start pt-2">
        <Show when={!props.hideCheckbox}>
          <div
            class={cn('w-0 opacity-0 overflow-hidden', {
              'w-6 opacity-100': props.checked,
            })}
          >
            <MultiSelectCheckbox
              checked={props.checked}
              onChecked={props.onChecked}
            />
          </div>
        </Show>
      </Entity.Slot>

      <Entity.Slot
        placement="title"
        class="ph-no-capture flex min-w-0 items-center gap-2 truncate font-normal"
      >
        <Show when={props.unread} fallback={<div class="size-2" />}>
          <UnreadIndicator active />
        </Show>
        <div class="size-4 shrink-0">
          <Entity.Icon entity={props.entity} streamState={props.streamState} />
        </div>
        <Entity.Title entity={props.entity} />
        <Show
          when={
            isChannelEntity(props.entity) &&
            props.entity.isParticipant === false &&
            props.entity
          }
        >
          {(entity) => (
            <ChannelJoinButton entity={entity()} class="ml-auto shrink-0" />
          )}
        </Show>
      </Entity.Slot>
    </Entity.Layout>
  );
}
