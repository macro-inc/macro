import type { DateValue } from '@core/util/date';
import { Entity } from '../entity';
import {
  isChannelEntity,
  isEmailEntity,
  isProjectContainedEntity,
  type ProjectEntity,
  type EntityData,
  isTaskEntity,
} from '../types/entity';
import { Match, Show, Switch, type Ref } from 'solid-js';
import {
  isWithNotification,
  type WithNotification,
} from '../types/notification';
import { unreadFilterFn } from '../utils/filter';
import { cn } from '@ui/utils/classname';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import type { SearchLocation } from '../types/search';
import { isSearchEntity } from '../types/search';
import { createEntityDraggable } from '../utils/draggable';
import { UnreadIndicator } from '../components/UnreadIndicator';
import { MultiSelectCheckbox } from '../components/MultiSelectCheckbox';
import { DraftBadge, SharedBadge } from '../components/Badges';
import { DisplayName } from '../components/DisplayName';
import { useIsShared } from '../utils/shared';
import { ProjectBreadCrumb } from '../components/ProjectBreadCrumb';
import {
  filterNotDoneNotifications,
  filterValidNotifications,
} from '../utils/notification';
import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { mergeRefs } from '@solid-primitives/refs';

const hasSearchContentHits = (entity: EntityData) =>
  isSearchEntity(entity) && !!entity.search.contentHitData?.length;

interface ListEntityProps {
  entity: WithNotification<EntityData>;
  onClick?: (event: MouseEvent) => void;
  timestamp?: DateValue | null;
  ref?: Ref<HTMLDivElement>;
  checked?: boolean;
  highlighted?: boolean;
  hovered?: boolean;
  hideContentHits?: boolean;
  onChecked?: (checked: boolean, shiftKey: boolean) => void;
  onMouseMove?: () => void;
  showUnrollNotifications?: boolean;
  onProjectClick?: (
    entity: ProjectEntity,
    e: PointerEvent | MouseEvent
  ) => void;
  onContentHitClick?: (
    e: PointerEvent | MouseEvent,
    location?: SearchLocation
  ) => void;
}

interface LayoutProps {
  entity: WithNotification<EntityData>;
  checked?: boolean;
  onChecked?: (checked: boolean, shiftKey: boolean) => void;
  unread: boolean;
  isShared: boolean;
  hasNotifications: boolean;
  showContentHits: boolean;
  onProjectClick?: (
    entity: ProjectEntity,
    e: PointerEvent | MouseEvent
  ) => void;
}

function NarrowLayout(props: LayoutProps) {
  return (
    <Entity.Layout
      class="w-full gap-x-2 items-center text-sm pl-0 px-2 grid @lg/entity:hidden"
      style={{
        'grid-template-columns': 'auto 1fr 8ch',
        'grid-template-rows': '2.5rem auto',
        'grid-template-areas':
          '"indicator title timestamp" "indicator body body"',
      }}
    >
      <Entity.Slot placement="indicator" class="relative self-start pt-3">
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
      </Entity.Slot>

      <Entity.Slot
        placement="title"
        class="flex items-center gap-2 truncate font-semibold"
      >
        <Show when={props.unread}>
          <UnreadIndicator active />
        </Show>
        <div class="size-4 shrink-0">
          <Entity.Icon entity={props.entity} />
        </div>
        <Switch>
          <Match when={isEmailEntity(props.entity) && props.entity}>
            {(entity) => (
              <>
                <Show when={entity().isDraft}>
                  <DraftBadge />
                </Show>
                <span class="truncate">
                  <Entity.EmailParticipants entity={entity()} />
                </span>
              </>
            )}
          </Match>
          <Match when={props.entity}>
            {(entity) => <Entity.Title entity={entity()} />}
          </Match>
        </Switch>
        <Show when={isTaskEntity(props.entity) && props.entity}>
          {(entity) => <Entity.Properties entity={entity()} />}
        </Show>
      </Entity.Slot>

      <Entity.Slot
        placement="timestamp"
        class="text-xs font-mono text-right text-ink-extra-muted uppercase font-light"
      >
        <Show when={!props.hasNotifications}>
          <Entity.Timestamp entity={props.entity} />
        </Show>
      </Entity.Slot>

      <Show
        when={
          (isEmailEntity(props.entity) || isChannelEntity(props.entity)) &&
          !props.hasNotifications &&
          !props.showContentHits
        }
      >
        <Entity.Slot placement="body" class="flex flex-col gap-1 pb-3 -mt-1">
          <Switch>
            <Match when={isEmailEntity(props.entity) && props.entity}>
              {(entity) => (
                <>
                  <div class="flex items-center gap-2 font-semibold truncate">
                    <span class="truncate">
                      <Entity.Title entity={entity()} />
                    </span>
                  </div>
                  <div class="text-ink/50 font-medium w-full truncate">
                    <span class="truncate">{entity().snippet}</span>
                  </div>
                </>
              )}
            </Match>
            <Match when={isChannelEntity(props.entity) && props.entity}>
              {(entity) => (
                <Show when={entity().latestMessage}>
                  {(msg) => (
                    <div class="flex items-center gap-2 w-full truncate">
                      <span class="font-semibold truncate min-w-min max-w-1/3">
                        <DisplayName id={msg().senderId} format="firstName" />
                      </span>
                      <span class="text-ink/50 font-medium truncate inline-flex items-center shrink">
                        <StaticMarkdown
                          theme={unifiedListMarkdownTheme}
                          markdown={msg().content}
                          singleLine
                        />
                      </span>
                    </div>
                  )}
                </Show>
              )}
            </Match>
          </Switch>
        </Entity.Slot>
      </Show>
    </Entity.Layout>
  );
}

function WideLayout(props: LayoutProps) {
  return (
    <Entity.Layout
      class={cn(
        'w-full min-h-[inherit] items-center text-sm px-2',
        'gap-2 grid grid-cols-[1rem_1fr_auto_8ch] grid-rows-[1fr]',
        '[--title-width:clamp(6rem,20%,16rem)]',
        'hidden @lg/entity:grid'
      )}
      style={{
        'grid-template-areas': '"indicator content meta timestamp"',
      }}
    >
      <Entity.Slot placement="indicator" class="relative size-full group">
        <div class="absolute inset-0 grid place-items-center group-hover:opacity-0">
          <UnreadIndicator active={props.unread} />
        </div>
        <div
          class={cn(
            'absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100',
            {
              'opacity-100': props.checked,
            }
          )}
        >
          <MultiSelectCheckbox
            checked={props.checked}
            onChecked={props.onChecked}
          />
        </div>
      </Entity.Slot>

      <Entity.Slot
        placement="content"
        class="font-semibold truncate items-center gap-2 flex"
      >
        <div class="size-4 shrink-0">
          <Entity.Icon entity={props.entity} />
        </div>
        <Switch>
          <Match when={isEmailEntity(props.entity) && props.entity}>
            {(entity) => (
              <>
                <Show
                  when={!props.showContentHits}
                  fallback={
                    <>
                      <span class="truncate">
                        <Entity.Title entity={entity()} />
                      </span>
                      <span class="text-ink/50 font-medium truncate flex-1">
                        {entity().snippet}
                      </span>
                    </>
                  }
                >
                  <span class="w-(--title-width) truncate shrink-0 flex gap-2">
                    <Show when={entity().isDraft}>
                      <DraftBadge />
                    </Show>
                    <span class="truncate">
                      <Entity.EmailParticipants entity={entity()} />
                    </span>
                  </span>
                  <span class="truncate">
                    <Entity.Title entity={entity()} />
                  </span>
                  <span class="text-ink/50 font-medium truncate flex-1">
                    {entity().snippet}
                  </span>
                </Show>
              </>
            )}
          </Match>
          <Match when={isChannelEntity(props.entity) && props.entity}>
            {(entity) => (
              <>
                <span class="w-(--title-width) shrink-0 truncate flex gap-2">
                  <Entity.Title entity={entity()} />
                </span>
                <Show when={!props.hasNotifications && entity().latestMessage}>
                  {(msg) => (
                    <>
                      <DisplayName id={msg().senderId} format="firstName" />
                      <span class="text-ink/50 font-medium truncate inline-flex shrink items-center">
                        <StaticMarkdown
                          theme={unifiedListMarkdownTheme}
                          markdown={msg().content}
                          singleLine
                        />
                      </span>
                    </>
                  )}
                </Show>
              </>
            )}
          </Match>
          <Match when={props.entity}>
            {(entity) => <Entity.Title entity={entity()} />}
          </Match>
        </Switch>
      </Entity.Slot>

      <Entity.Slot placement="meta" class="flex items-center gap-2">
        <Show when={isProjectContainedEntity(props.entity) && props.entity}>
          {(entity) => (
            <span class="text-ink-extra-muted text-xs">
              <ProjectBreadCrumb
                entity={entity()}
                onClick={props.onProjectClick}
              />
            </span>
          )}
        </Show>
        <Show when={props.isShared}>
          <SharedBadge ownerId={props.entity.ownerId} />
        </Show>
        <Show when={isTaskEntity(props.entity) && props.entity}>
          {(entity) => <Entity.Properties entity={entity()} />}
        </Show>
      </Entity.Slot>

      <Entity.Slot
        placement="timestamp"
        class="text-xs font-mono text-right text-ink-extra-muted uppercase font-light"
      >
        <Show when={!props.hasNotifications}>
          <Entity.Timestamp entity={props.entity} />
        </Show>
      </Entity.Slot>
    </Entity.Layout>
  );
}

export function ListEntity(props: ListEntityProps) {
  const unread = () => unreadFilterFn(props.entity);
  const isShared = useIsShared(props.entity);

  const hasNotifications = () => {
    if (!props.showUnrollNotifications) return false;
    if (!isWithNotification(props.entity)) return false;
    return (
      filterNotDoneNotifications(
        filterValidNotifications(props.entity.notifications?.())
      ).length > 0
    );
  };

  const showContentHits = () =>
    !props.hideContentHits && hasSearchContentHits(props.entity);

  const layoutProps = (): LayoutProps => ({
    entity: props.entity,
    checked: props.checked,
    onChecked: props.onChecked,
    unread: unread(),
    isShared: isShared(),
    hasNotifications: hasNotifications(),
    showContentHits: showContentHits(),
    onProjectClick: props.onProjectClick,
  });

  const draggable = createEntityDraggable({
    entity: props.entity,
    splitId: useSplitPanel()?.handle?.id,
  });

  return (
    <Entity.Root
      entity={props.entity}
      onClick={(e) => {
        if (e.metaKey && props.onChecked) {
          props.onChecked(!props.checked, e.shiftKey);
          return;
        }
        props.onClick?.(e);
      }}
      ref={mergeRefs(props.ref, draggable)}
      class={cn('@container/entity w-full min-h-10 relative group/narrow', {
        'bg-accent/5': props.checked,
        'hover:bg-hover/30':
          !props.checked && !props.highlighted && !props.hovered,
        'bg-hover/20': props.hovered && !props.highlighted && !props.checked,
        'bg-accent/5 outline-1 outline-accent/20 outline-offset-[-1px]':
          props.highlighted,
      })}
      onMouseMove={props.onMouseMove}
    >
      <div
        class={cn('absolute h-full w-[3px] left-0 top-0 bg-accent opacity-0', {
          'opacity-100': props.highlighted,
        })}
      />

      <NarrowLayout {...layoutProps()} />
      <WideLayout {...layoutProps()} />

      <Show when={hasNotifications()}>
        <div class="flex gap-2 w-full h-full items-center text-sm px-2 pb-1 -mt-2 min-w-0 overflow-hidden">
          <div class={cn('min-w-0 flex-1 truncate ml-2 @lg/entity:ml-6')}>
            <Show when={isWithNotification(props.entity) && !showContentHits()}>
              <Entity.Notification.Stacks
                entity={props.entity}
                visibleCount={3}
              />
            </Show>
          </div>
        </div>
      </Show>

      <Show when={showContentHits()}>
        <div class="flex gap-2 w-full h-full items-center text-sm px-2 pb-1 -mt-2 min-w-0 overflow-hidden">
          <div class={cn('min-w-0 flex-1 truncate ml-4 @lg/entity:ml-6')}>
            <Entity.Search.ContentHits
              entity={props.entity}
              onClick={props.onContentHitClick}
              visibleCount={0}
            />
          </div>
        </div>
      </Show>
    </Entity.Root>
  );
}
