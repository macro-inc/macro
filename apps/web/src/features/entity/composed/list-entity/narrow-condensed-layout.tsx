import { Show } from 'solid-js';
import { Entity } from '../../entity';
import { isChannelEntity } from '../../types/entity';
import { ChannelActiveCallBadge, ChannelJoinButton } from './channel';
import { type LayoutProps, RowIndicator } from './shared';

/** Condensed row used for maximum density. */
export function NarrowCondensedLayout(props: LayoutProps) {
  return (
    <Entity.Layout
      class="w-full gap-x-1 items-center pr-2 pl-1 grid text-sm"
      style={{
        'grid-template-columns': 'auto 1fr',
        'grid-template-rows': '36px',
        'grid-template-areas': '"indicator title"',
      }}
    >
      <Entity.Slot placement="indicator" class="relative">
        <RowIndicator
          checked={props.checked}
          hideCheckbox={props.hideCheckbox}
          onChecked={props.onChecked}
          unread={props.unread}
        />
      </Entity.Slot>

      <Entity.Slot
        placement="title"
        class="ph-no-capture flex min-w-0 items-center gap-2 truncate font-normal"
      >
        <div class="size-4 shrink-0">
          <Entity.Icon entity={props.entity} streamState={props.streamState} />
        </div>
        <Entity.Title entity={props.entity} />
        <Show when={isChannelEntity(props.entity) && props.entity}>
          {(entity) => (
            <span class="ml-auto shrink-0 flex items-center">
              <ChannelActiveCallBadge channelId={entity().id} />
            </span>
          )}
        </Show>
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
