import '@entity/composed/ListEntity.css';
import { EntityRow, EntityRowContext } from '@app/component/mobile/EntityRow';
import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  createEntityDraggable,
  Entity,
  filterNotDoneNotifications,
  filterValidNotifications,
  isWithNotification,
  unreadFilterFn,
  useIsShared,
} from '@entity';
import { NarrowLayout } from '@entity/composed/list-entity/narrow-layout';
import {
  type BaseListEntityProps,
  hasSearchContentHits,
  type LayoutProps,
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
import { TaskGridLayout } from './task-grid-layout';

interface TaskListEntityProps extends BaseListEntityProps {
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
        'soup-list-entity @container/entity w-[calc(100%-0.5rem)] mr-1 relative group/narrow flex flex-col py-0.5 rounded-lg',
        {
          'min-h-10 mx-1': !isMobile(),
          'bg-accent/8': props.checked,
          'ring ring-accent/16 ring-inset':
            props.checked && props.highlighted && !isTouchDevice(),
          'ring ring-edge bg-active/60 ring-inset':
            props.highlighted && !props.checked && !isTouchDevice(),
          'hover:bg-active/30':
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
