import { UserIcon } from '@core/component/UserIcon';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { MultiSelectCheckbox } from '../../components/MultiSelectCheckbox';
import { UnreadIndicator } from '../../components/UnreadIndicator';
import { Entity } from '../../entity';
import { SearchContent } from '../../extractors-search/search-content';
import { SearchSender } from '../../extractors-search/search-sender';
import {
  isChannelEntity,
  isChannelMessageEntity,
  isEmailEntity,
  isTaskEntity,
} from '../../types/entity';
import { isSearchEntity } from '../../types/search';
import { EmailInboxChip } from './email';
import type { LayoutProps } from './shared';

export function NarrowLayout(props: LayoutProps) {
  return (
    <Entity.Layout
      class="w-full gap-x-2 items-center text-sm px-2 grid"
      style={{
        'grid-template-columns': 'auto 1fr max-content',
        'grid-template-rows': '44px',
        'grid-template-areas': '"indicator title timestamp"',
      }}
    >
      <Entity.Slot placement="indicator" class="relative self-start pt-3">
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
        class="ph-no-capture flex items-center gap-2 truncate font-semibold"
      >
        <Show when={props.unread}>
          <UnreadIndicator active />
        </Show>
        <div class="size-4 shrink-0">
          <Entity.Icon entity={props.entity} streamState={props.streamState} />
        </div>
        <Show
          when={isChannelMessageEntity(props.entity) && props.entity}
          fallback={<Entity.Title entity={props.entity} />}
        >
          {(entity) => {
            const hit = () => {
              const e = entity();
              return isSearchEntity(e)
                ? e.search.contentHitData?.[0]
                : undefined;
            };
            return (
              <span class="flex items-center gap-1 min-w-0 truncate">
                <span class="shrink-0 text-ink-muted text-xs whitespace-nowrap">
                  {entity().channelName}
                </span>
                <Show when={entity().senderId}>
                  {(id) => <UserIcon id={id()} size="sm" />}
                </Show>
                <Show when={hit()}>
                  {(h) => (
                    <span class="shrink-0 text-ink-extra-muted text-xs whitespace-nowrap">
                      <SearchSender hit={h()} />
                    </span>
                  )}
                </Show>
                <span class="text-ink/50 font-normal truncate min-w-0">
                  <Show when={hit()} fallback={entity().content}>
                    {(h) => <SearchContent hit={h()} singleLine />}
                  </Show>
                </span>
              </span>
            );
          }}
        </Show>
        <Show when={isEmailEntity(props.entity) && props.entity}>
          {(entity) => <EmailInboxChip entity={entity()} class="ml-auto" />}
        </Show>
      </Entity.Slot>

      <Show
        when={
          !props.hasNotifications &&
          !(isChannelEntity(props.entity) && isSearchEntity(props.entity))
        }
      >
        <Entity.Slot
          placement="timestamp"
          class="text-xs text-right text-ink-extra-muted font-light"
        >
          <Show
            when={!isTaskEntity(props.entity)}
            fallback={
              <Entity.Properties
                entity={props.entity}
                maxUserStackUsers={0}
                showCaret={false}
              />
            }
          >
            <Entity.Timestamp entity={props.entity} />
          </Show>
        </Entity.Slot>
      </Show>
    </Entity.Layout>
  );
}
