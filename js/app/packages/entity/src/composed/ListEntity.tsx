import './ListEntity.css';
import { EntityRow, EntityRowContext } from '@app/component/mobile/EntityRow';
import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { stackNotifications } from '@notifications';
import {
  BULK_DOCUMENT_WAKEUP_FEATURE_FLAG,
  enqueueDocumentWakeup,
  isWakeableDocument,
} from '@queries/preview';
import {
  getStreamState,
  subscribeToStreamState,
} from '@service-connection/stream-events';
import { mergeRefs } from '@solid-primitives/refs';
import { cn } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
  useContext,
} from 'solid-js';
import { Entity } from '../entity';
import type { EntityRowConfig } from '../extractors-notification';
import {
  isHitSnippetComplete,
  isHitSnippetEntity,
} from '../extractors-search/snippet-entity';
import { isChannelEntity, isEmailEntity } from '../types/entity';
import { isWithNotification } from '../types/notification';
import { isSearchEntity } from '../types/search';
import { createEntityDraggable } from '../utils/draggable';
import { unreadFilterFn } from '../utils/filter';
import {
  filterNotDoneNotifications,
  filterValidNotifications,
} from '../utils/notification';
import { useIsShared } from '../utils/shared';
import { NarrowInboxLayout } from './list-entity/narrow-inbox-layout';
import { NarrowLayout } from './list-entity/narrow-layout';
import {
  type BaseListEntityProps,
  hasSearchContentHits,
  InboxDivider,
  type LayoutProps,
  useCharacterCount,
  useListLayout,
} from './list-entity/shared';
import { WideLayout } from './list-entity/wide-layout';

export { ListLayoutProvider } from './list-entity/shared';

interface ListEntityProps extends BaseListEntityProps {
  showUnrollNotifications?: boolean;
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
  const bulkWakeupEnabled = useFeatureFlag(BULK_DOCUMENT_WAKEUP_FEATURE_FLAG);

  createEffect(() => {
    if (!bulkWakeupEnabled().enabled) return;
    if (!isWakeableDocument(props.entity)) return;

    enqueueDocumentWakeup(props.entity);
  });

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
    if (!isHitSnippetEntity(props.entity)) return false;
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
    hideCheckbox: props.hideCheckbox,
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

  // A single stack collapses into the condensed entity row only when it's a
  // new-messages-in-a-channel stack — the entity (channel) preview already
  // conveys "new messages here". Replies, mentions, and other types carry
  // per-stack context worth showing, so they render as a stack even when
  // alone.
  const shouldUnrollStacks = () => {
    const stacks = mobileStacks();
    if (stacks.length === 0) return false;
    if (stacks.length > 1) return true;
    return stacks[0].type !== 'channel_message_send';
  };

  // Latch to true once the stack view has ever been used (including async
  // arrivals). Prevents a jarring layout switch when notifications drop back
  // to a single condensable stack.
  const [hasBeenUnrolled, setHasBeenUnrolled] = createSignal(
    shouldUnrollStacks()
  );
  createEffect(() => {
    if (shouldUnrollStacks()) setHasBeenUnrolled(true);
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
        'soup-list-entity rounded-lg @container/entity w-[calc(100%-0.5rem)] mr-1 relative group/narrow flex flex-col py-0.5',
        {
          'min-h-10 mx-1': !isMobile(),
          'bg-accent/8': props.checked,
          'bg-accent/16': props.checked && props.highlighted,
          'bg-hover/30':
            props.highlighted && !props.checked && !isTouchDevice(),
          'hover:bg-hover/30':
            !props.highlighted && !props.checked && !isTouchDevice(),
        }
      )}
      onMouseMove={props.onMouseMove}
    >
      <Switch>
        <Match when={isWide()}>
          <MaybeEntityRow
            entityId={props.entity.id}
            config={props.entityRowConfig}
          >
            <WideLayout {...layoutProps()} />
          </MaybeEntityRow>
        </Match>
        <Match when={isMobile() && (hasBeenUnrolled() || shouldUnrollStacks())}>
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
        <div class="px-2 pb-1.5 -mt-1 min-w-0 overflow-hidden">
          <div class={cn('min-w-0 flex-1 ml-2 @lg/entity:ml-6')}>
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
        <div class="flex gap-2 size-full items-center text-sm px-2 pb-1 -mt-2 min-w-0">
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
