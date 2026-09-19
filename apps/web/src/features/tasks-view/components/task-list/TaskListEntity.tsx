import '@entity/composed/ListEntity.css';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  SwipableRow,
  SwipableRowContext,
} from '@components/app/mobile/SwipableRow';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  createEntityDraggable,
  Entity,
  filterNotDoneNotifications,
  filterValidNotifications,
  isWithNotification,
  type TaskEntityWithProperties,
  unreadFilterFn,
  useIsShared,
} from '@entity';
import { NarrowLayout } from '@entity/composed/list-entity/narrow-layout';
import {
  type BaseListEntityProps,
  hasSearchContentHits,
  useCharacterCount,
  useListLayout,
} from '@entity/composed/list-entity/shared';
import type { EntityRowConfig } from '@entity/extractors-notification';
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
import { cn } from '@ui/utils/classname';
import {
  createEffect,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
  useContext,
} from 'solid-js';
import { TaskGridLayout } from './TaskGridLayout';

type TaskListEntityProps = Omit<BaseListEntityProps, 'entity'> & {
  entity: TaskEntityWithProperties;
  rowId?: string;
  showUnrollNotifications?: boolean;
};

function MaybeEntityRow(props: {
  entityId: string;
  children: JSX.Element;
  config?: EntityRowConfig;
}) {
  const ctx = useContext(SwipableRowContext);
  return (
    <Show when={isMobile() && ctx} fallback={props.children}>
      <SwipableRow
        id={props.entityId}
        swipeLeftColor={props.config?.swipeLeftColor}
        swipeLeftRevealedComponent={props.config?.swipeLeftRevealedComponent}
        swipeRightColor={props.config?.swipeRightColor}
        swipeRightRevealedComponent={props.config?.swipeRightRevealedComponent}
      >
        {props.children}
      </SwipableRow>
    </Show>
  );
}

/**
 * Task-specific list entity that renders properties (Status, Priority,
 * Assignees, Due Date) in fixed-width grid columns so they line up
 * vertically across rows in a list.
 */
export function TaskListEntity(props: TaskListEntityProps) {
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

  const showHitSnippet = () =>
    !props.hideContentHits && hasSearchContentHits(props.entity);

  const showContentHits = () => showHitSnippet();

  const layoutProps = () => ({
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

  return (
    <Entity.Root
      id={props.rowId}
      role={props.rowId ? 'row' : undefined}
      aria-selected={props.rowId ? props.checked : undefined}
      tabIndex={props.rowId ? -1 : undefined}
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
        'soup-list-entity @container/entity w-[calc(100%-0.5rem)] mr-1 relative group/narrow flex flex-col py-0.5 rounded-lg',
        {
          'min-h-10 mx-1': !isMobile(),
          'bg-list-selected': props.checked,
          'bg-list-selected-highlighted':
            props.checked && props.highlighted && !isTouchDevice(),
          'bg-list-highlighted':
            props.highlighted && !props.checked && !isTouchDevice(),
          'hover:bg-list-hover':
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
            <TaskGridLayout {...layoutProps()} />
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
