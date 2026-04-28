import './ListEntity.css';
import { EntityRow, EntityRowContext } from '@app/component/mobile/EntityRow';
import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { isMobile } from '@core/mobile/isMobile';
import type { DateValue } from '@core/util/date';
import { stackNotifications } from '@notifications';
import {
  getStreamState,
  subscribeToStreamState,
} from '@service-connection/stream-events';
import { mergeRefs } from '@solid-primitives/refs';
import { cn } from '@ui/utils/classname';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  Match,
  type Ref,
  Show,
  Switch,
  useContext,
} from 'solid-js';
import { Entity } from '../entity';
import type { EntityRowConfig } from '../extractors-notification';
import {
  isHitSnippetComplete,
  isSnippetEntity,
} from '../extractors-search/snippet-entity';
import {
  isChannelEntity,
  isEmailEntity,
  type EntityData,
  type ProjectEntity,
} from '../types/entity';
import {
  isWithNotification,
  type WithNotification,
} from '../types/notification';
import { isSearchEntity, type SearchLocation } from '../types/search';
import { createEntityDraggable } from '../utils/draggable';
import { unreadFilterFn } from '../utils/filter';
import {
  filterNotDoneNotifications,
  filterValidNotifications,
} from '../utils/notification';
import { useIsShared } from '../utils/shared';
import {
  hasSearchContentHits,
  InboxDivider,
  type LayoutProps,
  useCharacterCount,
  useListLayout,
} from './list-entity/shared';
import { NarrowInboxLayout } from './list-entity/narrow-inbox-layout';
import { NarrowLayout } from './list-entity/narrow-layout';
import { WideLayout } from './list-entity/wide-layout';

export { ListLayoutProvider } from './list-entity/shared';

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
  entityRowConfig?: EntityRowConfig;
}

function MaybeEntityRow(props: {
  entityId: string;
  children: JSX.Element;
  config?: EntityRowConfig;
}) {
  const ctx = useContext(EntityRowContext);
  return (
    <Show when={isMobile() && ctx} fallback={props.children}>
      <EntityRow
        entityId={props.entityId}
        swipeLeftColor={props.config?.swipeLeftColor}
        swipeLeftRevealedComponent={props.config?.swipeLeftRevealedComponent}
        swipeRightColor={props.config?.swipeRightColor}
        swipeRightRevealedComponent={props.config?.swipeRightRevealedComponent}
      >
        {props.children}
      </EntityRow>
    </Show>
  );
}

export function ListEntity(props: ListEntityProps) {
  const unread = () => unreadFilterFn(props.entity);
  const isShared = useIsShared(props.entity);

  subscribeToStreamState(props.entity.id, props.entity.type);
  const streamState = getStreamState(props.entity.id);

  const hasNotifications = () => {
    if (!props.showUnrollNotifications) return false;
    if (!isWithNotification(props.entity)) return false;
    return (
      filterNotDoneNotifications(
        filterValidNotifications(props.entity.notifications?.())
      ).length > 0
    );
  };

  const [snippetContainerRef, setSnippetContainerRef] = createSignal<
    HTMLElement | undefined
  >();
  const chars = useCharacterCount(snippetContainerRef);

  // For singleton hits on a SnippetEntity, expanding "show more" only adds
  // value when windowSearchMatch trimmed text — otherwise the inline
  // snippet already shows everything.
  const isContentHitsRedundant = () => {
    if (!isSnippetEntity(props.entity)) return false;
    if (!isSearchEntity(props.entity)) return false;
    const hits = props.entity.search.contentHitData;
    if (!hits || hits.length !== 1) return false;
    return isHitSnippetComplete(hits[0].content, chars());
  };

  // Render the highlighted hit snippet whenever the entity has hits — even
  // if the expandable panel is suppressed as redundant, the inline snippet
  // should still highlight the match.
  const showHitSnippet = () =>
    !props.hideContentHits && hasSearchContentHits(props.entity);

  const showContentHits = () => showHitSnippet() && !isContentHitsRedundant();

  const layoutProps = (): LayoutProps => ({
    entity: props.entity,
    checked: props.checked,
    onChecked: props.onChecked,
    unread: unread(),
    isShared: isShared(),
    hasNotifications: hasNotifications(),
    showHitSnippet: showHitSnippet(),
    streamState: streamState(),
    setSnippetContainerRef,
    chars: chars(),
    onProjectClick: props.onProjectClick,
  });

  const draggable = createEntityDraggable({
    entity: props.entity,
    splitId: useSplitPanel()?.handle?.id,
  });

  const isWide = useListLayout()?.isWide ?? (() => true);

  const mobileStacks = createMemo(() => {
    if (!isMobile()) return [];
    if (!props.showUnrollNotifications) return [];
    const notifs = props.entity.notifications?.();
    if (!notifs?.length) return [];
    const validNotifs = filterNotDoneNotifications(
      filterValidNotifications(notifs)
    );
    if (!validNotifs.length) return [];
    return stackNotifications(validNotifs);
  });

  // Latch to true once multi-stack is ever seen (including async arrivals).
  // Prevents a jarring layout switch when swiping down to 1 stack.
  const [hasBeenMultiStack, setHasBeenMultiStack] = createSignal(
    mobileStacks().length > 1
  );
  createEffect(() => {
    if (mobileStacks().length > 1) setHasBeenMultiStack(true);
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
      class={cn(
        'soup-list-entity @container/entity w-full relative group/narrow flex flex-col',
        {
          'min-h-10': !isMobile(),
          'bg-accent/5': props.checked,
          'hover:bg-hover/30':
            !props.checked && !props.highlighted && !props.hovered,
          'bg-hover/20': props.hovered && !props.highlighted && !props.checked,
          'bg-accent/5 outline-1 outline-accent/20 -outline-offset-1':
            props.highlighted && !isMobile(),
        }
      )}
      onMouseMove={props.onMouseMove}
    >
      <div
        data-accent-bar
        class={cn('absolute h-full w-[3px] left-0 top-0 bg-accent opacity-0', {
          'opacity-100': props.highlighted && !isMobile(),
        })}
      />

      <Switch>
        <Match when={isWide()}>
          <MaybeEntityRow
            entityId={props.entity.id}
            config={props.entityRowConfig}
          >
            <WideLayout {...layoutProps()} />
          </MaybeEntityRow>
        </Match>
        <Match
          when={
            isMobile() && (hasBeenMultiStack() || mobileStacks().length > 1)
          }
        >
          <Entity.Notification.MobileStacks
            stacks={mobileStacks()}
            entity={props.entity}
            entityRowConfig={props.entityRowConfig}
          />
          <InboxDivider />
        </Match>
        <Match
          when={
            isMobile() &&
            (isChannelEntity(props.entity) ||
              isEmailEntity(props.entity) ||
              props.showUnrollNotifications)
          }
        >
          <MaybeEntityRow
            entityId={props.entity.id}
            config={props.entityRowConfig}
          >
            <NarrowInboxLayout {...layoutProps()} />
          </MaybeEntityRow>
        </Match>
        <Match when={true}>
          <MaybeEntityRow
            entityId={props.entity.id}
            config={props.entityRowConfig}
          >
            <NarrowLayout {...layoutProps()} />
          </MaybeEntityRow>
        </Match>
      </Switch>

      <Show when={hasNotifications() && !isMobile()}>
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
        <div class="flex gap-2 w-full h-full items-center text-sm px-2 pb-1 -mt-2 min-w-0">
          <div
            class={cn('min-w-0 flex-1 overflow-hidden ml-4 @lg/entity:ml-6')}
          >
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
