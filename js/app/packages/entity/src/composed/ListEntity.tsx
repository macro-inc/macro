import type { DateValue } from '@core/util/date';
import {
  visibleLength,
  windowSearchMatch,
  HighlightRender,
} from '@core/util/searchHighlight';
import { Entity } from '../entity';
import type { StreamEvent } from '@service-connection/generated/schemas';
import {
  isChannelEntity,
  isEmailEntity,
  isProjectContainedEntity,
  type ChannelEntity,
  type EmailEntity,
  type ProjectEntity,
  type EntityData,
  isTaskEntity,
} from '../types/entity';
import {
  type Accessor,
  createContext,
  createEffect,
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
  useContext,
  type Ref,
  type JSX,
} from 'solid-js';
import {
  getStreamState,
  subscribeToStreamState,
} from '@service-connection/stream-events';
import {
  isWithNotification,
  type WithNotification,
} from '../types/notification';
import { unreadFilterFn } from '../utils/filter';
import { cn } from '@ui/utils/classname';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  twoLineClampMarkdownTheme,
  unifiedListMarkdownTheme,
} from '@core/component/LexicalMarkdown/theme';
import type { SearchLocation } from '../types/search';
import { isSearchEntity } from '../types/search';
import { createEntityDraggable } from '../utils/draggable';
import { UnreadIndicator } from '../components/UnreadIndicator';
import { MultiSelectCheckbox } from '../components/MultiSelectCheckbox';
import { DraftBadge, InviteBadge, SharedBadge } from '../components/Badges';
import { DisplayName } from '../components/DisplayName';
import { useIsShared } from '../utils/shared';
import { ProjectBreadCrumb } from '../components/ProjectBreadCrumb';
import {
  filterNotDoneNotifications,
  filterValidNotifications,
} from '../utils/notification';
import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { mergeRefs } from '@solid-primitives/refs';
import { createElementSize } from '@solid-primitives/resize-observer';

const WIDE_BREAKPOINT = 512; // @lg container query = 32rem

interface ListLayoutContextValue {
  isWide: Accessor<boolean>;
}

const ListLayoutContext = createContext<ListLayoutContextValue>();

export function ListLayoutProvider(props: {
  ref: Accessor<HTMLElement | undefined>;
  children: JSX.Element;
}) {
  const [isWide, setIsWide] = createSignal(true);

  createEffect(() => {
    const el = props.ref();
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setIsWide((entries[0]?.contentRect.width ?? 0) >= WIDE_BREAKPOINT);
    });
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });

  return (
    <ListLayoutContext.Provider value={{ isWide }}>
      {props.children}
    </ListLayoutContext.Provider>
  );
}

const useListLayout = () => useContext(ListLayoutContext);

const hasSearchContentHits = (entity: EntityData) =>
  isSearchEntity(entity) && !!entity.search.contentHitData?.length;

const getBestContentHitContent = (entity: EntityData) => {
  if (!isSearchEntity(entity)) return undefined;
  const hits = entity.search.contentHitData;
  if (!hits?.length) return undefined;
  if (hits.length === 1) return hits[0].content;

  let bestIdx = 0;
  let bestLen = visibleLength(hits[0].content);
  for (let i = 1; i < hits.length; i++) {
    const len = visibleLength(hits[i].content);
    if (len > bestLen) {
      bestLen = len;
      bestIdx = i;
    }
  }
  return hits[bestIdx].content;
};

function useCharacterCount(ref: Accessor<HTMLElement | undefined>) {
  const size = createElementSize(ref);
  const [chars, setChars] = createSignal(200);
  const CHAR_WIDTH_PX = 6; // this is an approximation for text-sm

  createEffect(() => {
    if (!size.width) return;
    const charCount = Math.round(size.width / CHAR_WIDTH_PX / 2);
    setChars(charCount);
  });

  return chars;
}

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
  streamState?: StreamEvent;
  onProjectClick?: (
    entity: ProjectEntity,
    e: PointerEvent | MouseEvent
  ) => void;
}

function EmailIdentity(props: { entity: EmailEntity }) {
  return (
    <>
      <Switch>
        <Match when={props.entity.isDraft}>
          <DraftBadge />
        </Match>
        <Match when={props.entity.hasIcsAttachment}>
          <InviteBadge />
        </Match>
      </Switch>
      <span class="truncate">
        <Entity.EmailParticipants entity={props.entity} />
      </span>
    </>
  );
}

function EmailSnippet(props: {
  entity: EmailEntity;
  showContentHits: boolean;
  chars: number;
}) {
  return (
    <Show
      when={props.showContentHits && getBestContentHitContent(props.entity)}
      fallback={props.entity.snippet}
    >
      {(content) => (
        <HighlightRender text={windowSearchMatch(content(), props.chars)} />
      )}
    </Show>
  );
}

function ChannelMessage(props: {
  message: NonNullable<ChannelEntity['latestMessage']>;
}) {
  const hasContent = () => Boolean(props.message.content?.trim());
  return (
    <>
      <span class="font-semibold truncate min-w-min max-w-1/3">
        <DisplayName id={props.message.senderId} format="firstName" />
      </span>
      <span class="text-ink/50 font-medium truncate inline-flex items-center shrink">
        <Show
          when={hasContent()}
          fallback={<span class="italic">Attached Items</span>}
        >
          <StaticMarkdown
            theme={unifiedListMarkdownTheme}
            markdown={props.message.content}
            singleLine
          />
        </Show>
      </span>
    </>
  );
}

function NarrowLayout(props: LayoutProps) {
  const [emailSnippetContainerRef, setEmailSnippetContainerRef] = createSignal<
    HTMLElement | undefined
  >();
  const chars = useCharacterCount(emailSnippetContainerRef);

  return (
    <Entity.Layout
      class="w-full gap-x-2 items-center text-sm pl-0 px-2 grid"
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
          <Entity.Icon entity={props.entity} streamState={props.streamState} />
        </div>
        <Switch>
          <Match when={isEmailEntity(props.entity) && props.entity}>
            {(entity) => <EmailIdentity entity={entity()} />}
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
          !props.hasNotifications
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
                  <div
                    ref={setEmailSnippetContainerRef}
                    class="text-ink/50 font-medium w-full truncate inline-flex items-center"
                  >
                    <EmailSnippet
                      entity={entity()}
                      showContentHits={props.showContentHits}
                      chars={chars()}
                    />
                  </div>
                </>
              )}
            </Match>
            <Match when={isChannelEntity(props.entity) && props.entity}>
              {(entity) => (
                <Show when={entity().latestMessage}>
                  {(msg) => (
                    <div class="flex items-center gap-2 w-full truncate">
                      <ChannelMessage message={msg()} />
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

function NarrowMessageLayout(props: LayoutProps) {
  const isDirectMessage = () =>
    isChannelEntity(props.entity) &&
    props.entity.channelType === 'direct_message';
  return (
    <Entity.Layout
      class="w-full text-sm grid"
      style={{
        'grid-template-columns': 'auto 1fr 8ch',
        'grid-template-rows': 'auto auto auto',
        'grid-template-areas':
          '"icon title timestamp" "icon body body" "icon body body"',
      }}
    >
      <Entity.Slot placement="icon" class="flex items-center self-center pr-3">
        <UnreadIndicator class="mx-2 size-2.75" active={props.unread} />
        <div class="relative size-11 shrink-0 group">
          <Show when={!props.checked}>
            <div class="absolute inset-0 grid place-items-center group-hover:opacity-0 transition-opacity">
              <Show
                when={isDirectMessage()}
                fallback={
                  <div class="size-11 bg-edge-muted rounded-full flex items-center justify-center">
                    <div class="size-6">
                      <Entity.Icon
                        entity={props.entity}
                        streamState={props.streamState}
                      />
                    </div>
                  </div>
                }
              >
                <div class="size-11">
                  <Entity.Icon
                    entity={props.entity}
                    streamState={props.streamState}
                    class="bg-edge-muted text-ink"
                  />
                </div>
              </Show>
            </div>
          </Show>
          {/* TODO: make multiselect work on mobile */}
          <div
            class={cn(
              'absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity',
              { 'opacity-100': props.checked }
            )}
          >
            <MultiSelectCheckbox
              checked={props.checked}
              onChecked={props.onChecked}
            />
          </div>
        </div>
      </Entity.Slot>

      <Entity.Slot
        placement="title"
        class="flex items-center gap-2 truncate font-semibold pt-3"
      >
        <Show when={isChannelEntity(props.entity) && props.entity}>
          {(entity) => <Entity.Title entity={entity()} />}
        </Show>
      </Entity.Slot>

      <Entity.Slot
        placement="timestamp"
        class="text-xs text-right text-ink-extra-muted font-light pt-3 pr-4"
      >
        <Show when={!props.hasNotifications}>
          <Entity.Timestamp entity={props.entity} />
        </Show>
      </Entity.Slot>

      <Show when={isChannelEntity(props.entity) && props.entity}>
        {(entity) => (
          <Show when={entity().latestMessage}>
            {(msg) => (
              <>
                <Entity.Slot
                  placement="body"
                  class="text-ink-extra-muted line-clamp-2 pb-2 min-h-[2lh] pr-4 border-b border-edge-muted"
                >
                  <Show
                    when={msg().content?.trim()}
                    fallback={<span class="italic">Attached Items</span>}
                  >
                    <StaticMarkdown
                      theme={twoLineClampMarkdownTheme}
                      markdown={msg().content.trim()}
                    />
                  </Show>
                </Entity.Slot>
              </>
            )}
          </Show>
        )}
      </Show>
    </Entity.Layout>
  );
}

function WideLayout(props: LayoutProps) {
  const [emailSnippetContainerRef, setEmailSnippetContainerRef] = createSignal<
    HTMLElement | undefined
  >();
  const chars = useCharacterCount(emailSnippetContainerRef);

  return (
    <Entity.Layout
      class={cn(
        'w-full min-h-[inherit] items-center text-sm px-2',
        'gap-2 grid grid-cols-[1rem_1fr_auto_8ch] grid-rows-[1fr]',
        '[--title-width:clamp(6rem,20%,16rem)]'
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
          <Entity.Icon entity={props.entity} streamState={props.streamState} />
        </div>
        <Switch>
          <Match when={isEmailEntity(props.entity) && props.entity}>
            {(entity) => (
              <>
                <span class="w-(--title-width) truncate shrink-0 flex gap-2">
                  <EmailIdentity entity={entity()} />
                </span>
                <span class="truncate">
                  <Entity.Title entity={entity()} />
                </span>
                <span
                  ref={setEmailSnippetContainerRef}
                  class="text-ink/50 font-medium truncate flex-1 inline-flex items-center"
                >
                  <EmailSnippet
                    entity={entity()}
                    showContentHits={props.showContentHits}
                    chars={chars()}
                  />
                </span>
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
                  {(msg) => <ChannelMessage message={msg()} />}
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
    streamState: streamState(),
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

      <Switch>
        <Match when={isWide()}>
          <WideLayout {...layoutProps()} />
        </Match>
        <Match when={isChannelEntity(props.entity) && !hasNotifications()}>
          <NarrowMessageLayout {...layoutProps()} />
        </Match>
        <Match when={true}>
          <NarrowLayout {...layoutProps()} />
        </Match>
      </Switch>

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
