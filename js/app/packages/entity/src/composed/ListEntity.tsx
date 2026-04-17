import './ListEntity.css';
import { EntityRow, EntityRowContext } from '@app/component/mobile/EntityRow';
import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  twoLineClampMarkdownTheme,
  unifiedListMarkdownTheme,
} from '@core/component/LexicalMarkdown/theme';
import { UserIcon } from '@core/component/UserIcon';
import { isMobile } from '@core/mobile/isMobile';
import type { NotificationType } from '@core/types';
import { tryMacroId, useDisplayNameParts } from '@core/user';
import type { DateValue } from '@core/util/date';
import {
  HighlightRender,
  visibleLength,
  windowSearchMatch,
} from '@core/util/searchHighlight';
import { DisplayName } from '@entity/components/DisplayName';
import { stackNotifications } from '@notifications';
import type { StreamEvent } from '@service-connection/generated/schemas';
import {
  getStreamState,
  subscribeToStreamState,
} from '@service-connection/stream-events';
import { mergeRefs } from '@solid-primitives/refs';
import { createElementSize } from '@solid-primitives/resize-observer';
import { cn } from '@ui/utils/classname';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  Match,
  onCleanup,
  type Ref,
  Show,
  Switch,
  useContext,
} from 'solid-js';
import { DraftBadge, SharedBadge } from '../components/Badges';
import { MultiSelectCheckbox } from '../components/MultiSelectCheckbox';
import { ProjectBreadCrumb } from '../components/ProjectBreadCrumb';
import { UnreadIndicator } from '../components/UnreadIndicator';
import { Entity } from '../entity';
import type { EntityRowConfig } from '../extractors-notification';
import { getActionVerb } from '../extractors-notification/notification-description-helpers';
import { SearchContent } from '../extractors-search/search-content';
import { SearchSender } from '../extractors-search/search-sender';
import {
  type ChannelEntity,
  type EmailEntity,
  type EntityData,
  isCallEntity,
  isChannelEntity,
  isChannelMessageEntity,
  isEmailEntity,
  isProjectContainedEntity,
  isAutomationEntity,
  isTaskEntity,
  type ProjectEntity,
  type AutomationEntity,
} from '../types/entity';
import {
  isWithNotification,
  type WithNotification,
} from '../types/notification';
import type { SearchLocation } from '../types/search';
import { isSearchEntity } from '../types/search';
import { createEntityDraggable } from '../utils/draggable';
import { unreadFilterFn } from '../utils/filter';
import {
  filterNotDoneNotifications,
  filterValidNotifications,
} from '../utils/notification';
import { useIsShared } from '../utils/shared';
import { formatDateAndTime } from '../utils/timestamp';
import { formatCallDuration } from '@block-call/utils';

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
  entityRowConfig?: EntityRowConfig;
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

function InboxDivider() {
  return (
    <div class="col-span-3 ml-(--soup-inbox-left-of-content) min-w-full min-h-[1px] max-h-[1px] bg-edge-muted" />
  );
}

function EmailIdentity(props: { entity: EmailEntity }) {
  return (
    <>
      <Show when={props.entity.isDraft}>
        <DraftBadge />
      </Show>
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

function AutomationSubtitle(props: { entity: AutomationEntity }) {
  return (
    <div class="text-xs font-mono text-right uppercase font-light">
      <Switch>
        <Match when={props.entity.isRunning}>
          <span class="flex items-center justify-end gap-1.5 text-accent">
            <span class="size-1.5 animate-pulse rounded-full bg-accent" />
            Running
          </span>
        </Match>
        <Match when={props.entity.enabled && props.entity.nextRunAt}>
          {(nextRunAt) => (
            <span class="text-ink-extra-muted">
              Next run {formatDateAndTime(nextRunAt())}
            </span>
          )}
        </Match>
        <Match when={!props.entity.enabled}>
          <span class="text-ink-extra-muted">Paused</span>
        </Match>
      </Switch>
    </div>
  );
}

function ChannelMessage(props: {
  message: NonNullable<ChannelEntity['latestMessage']>;
}) {
  const hasContent = () => Boolean(props.message.content?.trim());
  return (
    <>
      <span class="ph-no-capture font-semibold truncate min-w-min max-w-1/3 shrink-0">
        <DisplayName id={props.message.senderId} format="firstName" />
      </span>
      <span class="ph-no-capture text-ink/50 font-medium truncate inline-flex items-center shrink min-w-0">
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
              const e = entity() as EntityData;
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
                  {(id) => <UserIcon id={id()} size="xs" />}
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
      </Entity.Slot>

      <Show
        when={
          !props.hasNotifications &&
          !(isChannelEntity(props.entity) && isSearchEntity(props.entity))
        }
      >
        <Entity.Slot
          placement="timestamp"
          class="text-xs font-mono text-right text-ink-extra-muted uppercase font-light"
        >
          <Show
            when={!isTaskEntity(props.entity)}
            fallback={<Entity.Properties entity={props.entity} />}
          >
            <Entity.Timestamp entity={props.entity} />
          </Show>
        </Entity.Slot>
      </Show>
    </Entity.Layout>
  );
}

function NarrowInboxLayout(props: LayoutProps) {
  const isDirectMessage = () =>
    isChannelEntity(props.entity) &&
    props.entity.channelType === 'direct_message';

  const [emailSnippetContainerRef, setEmailSnippetContainerRef] = createSignal<
    HTMLElement | undefined
  >();
  const chars = useCharacterCount(emailSnippetContainerRef);

  const mostRecentMessageSenderName =
    isChannelEntity(props.entity) && props.entity.latestMessage?.senderId
      ? useDisplayNameParts(tryMacroId(props.entity.latestMessage?.senderId))
      : undefined;

  const firstNotification = () => {
    if (!isWithNotification(props.entity)) return undefined;
    return filterNotDoneNotifications(
      filterValidNotifications(props.entity.notifications?.())
    )[0];
  };

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
      <Entity.Slot
        placement="icon"
        class="flex items-center self-center pr-(--soup-inbox-icon-padding-r)"
      >
        <UnreadIndicator
          class="mx-(--soup-inbox-unread-indicator-padding-x) size-(--soup-inbox-unread-indicator-diameter)"
          active={props.unread}
        />
        <div class="relative size-(--soup-inbox-icon-diameter) shrink-0 group">
          <Show when={!props.checked}>
            <div class="absolute inset-0 grid place-items-center group-hover:opacity-0 transition-opacity">
              <Show
                when={isDirectMessage()}
                fallback={
                  <div class="size-(--soup-inbox-icon-diameter) bg-edge-muted rounded-full flex items-center justify-center">
                    <div class="size-[calc(var(--soup-inbox-icon-diameter)*var(--soup-inbox-icon-factor))]">
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
        class="ph-no-capture flex items-center gap-2 truncate font-semibold pt-3"
      >
        <Show
          when={isEmailEntity(props.entity) && props.entity}
          fallback={<Entity.Title entity={props.entity} />}
        >
          {(entity) => <EmailIdentity entity={entity()} />}
        </Show>
      </Entity.Slot>

      <Entity.Slot
        placement="timestamp"
        class="text-xs text-right text-ink-extra-muted font-light pt-3 pr-4"
      >
        <Show
          when={
            !props.hasNotifications &&
            !(isChannelEntity(props.entity) && isSearchEntity(props.entity))
          }
        >
          <Entity.Timestamp entity={props.entity} />
        </Show>
      </Entity.Slot>

      <Switch>
        <Match when={isChannelMessageEntity(props.entity) && props.entity}>
          {(entity) => {
            const hit = () => {
              const e = entity() as EntityData;
              return isSearchEntity(e)
                ? e.search.contentHitData?.[0]
                : undefined;
            };
            return (
              <Entity.Slot
                placement="body"
                class="flex flex-col pb-2 min-h-[2lh] pr-4"
              >
                <Show when={hit()}>
                  {(h) => (
                    <>
                      <span class="text-ink-muted text-xs flex items-center gap-1">
                        <Show when={entity().senderId}>
                          {(id) => <UserIcon id={id()} size="xs" />}
                        </Show>
                        <SearchSender hit={h()} />
                      </span>
                      <span class="text-ink-extra-muted truncate">
                        <SearchContent hit={h()} />
                      </span>
                    </>
                  )}
                </Show>
              </Entity.Slot>
            );
          }}
        </Match>
        <Match
          when={isChannelEntity(props.entity) && props.entity.latestMessage}
        >
          {(msg) => (
            <Entity.Slot
              placement="body"
              class="text-ink-extra-muted line-clamp-2 pb-2 min-h-[2lh] pr-4"
            >
              <Show
                when={msg().content?.trim()}
                fallback={<span class="italic">Attached Items</span>}
              >
                <StaticMarkdown
                  theme={twoLineClampMarkdownTheme}
                  markdown={(() => {
                    const name = mostRecentMessageSenderName?.firstName();
                    return (name ? `**${name}:** ` : '') + msg().content.trim();
                  })()}
                  singleLine
                />
              </Show>
            </Entity.Slot>
          )}
        </Match>
        <Match when={isEmailEntity(props.entity) && props.entity}>
          {(entity) => (
            <Entity.Slot
              placement="body"
              class="flex flex-col pb-2 min-h-[2lh] pr-4"
            >
              <Entity.Title entity={props.entity} />
              <span
                ref={setEmailSnippetContainerRef}
                class="text-ink/50 font-medium truncate"
              >
                <EmailSnippet
                  entity={entity()}
                  showContentHits={props.showContentHits}
                  chars={chars()}
                />
              </span>
            </Entity.Slot>
          )}
        </Match>
        <Match when={isTaskEntity(props.entity)}>
          <Entity.Slot
            placement="body"
            class="flex flex-col pb-2 min-h-[2lh] pr-4 "
          >
            <Entity.Properties entity={props.entity} />
            <Show when={firstNotification()}>
              {(notif) => (
                <span class="text-ink-extra-muted font-normal truncate">
                  <Show when={notif().sender_id}>
                    {(senderId) => (
                      <>
                        <DisplayName id={senderId()} format="firstName" />{' '}
                      </>
                    )}
                  </Show>
                  {getActionVerb(
                    notif().notification_event_type as NotificationType
                  )}
                </span>
              )}
            </Show>
          </Entity.Slot>
        </Match>
        <Match when={isCallEntity(props.entity) && props.entity}>
          {(entity) => (
            <Entity.Slot
              placement="body"
              class="flex flex-col pb-2 min-h-[2lh] pr-4"
            >
              <span class="text-ink-muted text-xs truncate">
                {entity().channelName ?? 'Call'}
              </span>
              <span class="text-ink-extra-muted text-xs">
                <Show
                  when={entity().durationMs}
                  fallback={entity().isActive ? 'In progress' : 'No duration'}
                >
                  {(ms) => formatCallDuration(ms())}
                </Show>
              </span>
            </Entity.Slot>
          )}
        </Match>
        <Match when={true}>
          <Entity.Slot placement="body" class="pb-2 min-h-[2lh] pr-4" />
        </Match>
      </Switch>
      <InboxDivider />
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
        '[--title-width:10rem]'
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
        class="ph-no-capture font-semibold truncate items-center gap-2 flex"
      >
        <div class="size-4 shrink-0">
          <Entity.Icon entity={props.entity} streamState={props.streamState} />
        </div>
        <Switch>
          <Match when={isEmailEntity(props.entity) && props.entity}>
            {(entity) => (
              <>
                <span class="w-(--title-width) shrink-0">
                  <span class="truncate max-w-[8rem] flex gap-2 items-center">
                    <EmailIdentity entity={entity()} />
                  </span>
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
          <Match when={isChannelMessageEntity(props.entity) && props.entity}>
            {(entity) => {
              const hit = () => {
                const e = entity() as EntityData;
                return isSearchEntity(e)
                  ? e.search.contentHitData?.[0]
                  : undefined;
              };
              return (
                <>
                  <span class="shrink-0 flex gap-1.5 items-center">
                    <span class="text-ink-muted whitespace-nowrap">
                      {entity().channelName}
                    </span>
                    <Show when={entity().senderId}>
                      {(id) => <UserIcon id={id()} size="xs" />}
                    </Show>
                    <Show when={hit()}>
                      {(h) => (
                        <span class="text-ink-extra-muted text-xs whitespace-nowrap">
                          <SearchSender hit={h()} />
                        </span>
                      )}
                    </Show>
                  </span>
                  <div class="text-ink/50 font-medium flex-1 min-w-0 overflow-hidden">
                    <Show when={hit()} fallback={entity().content}>
                      {(h) => <SearchContent hit={h()} singleLine />}
                    </Show>
                  </div>
                </>
              );
            }}
          </Match>
          <Match when={isChannelEntity(props.entity) && props.entity}>
            {(entity) => (
              <Show
                when={!props.hasNotifications && entity().latestMessage}
                fallback={
                  <span class="truncate flex gap-2">
                    <Entity.Title entity={entity()} />
                  </span>
                }
              >
                {(msg) => (
                  <>
                    <span class="w-(--title-width) shrink-0 truncate flex gap-2">
                      <Entity.Title entity={entity()} />
                    </span>
                    <ChannelMessage message={msg()} />
                  </>
                )}
              </Show>
            )}
          </Match>
          <Match when={isCallEntity(props.entity) && props.entity}>
            {(entity) => (
              <>
                <Entity.Title entity={entity()} />
                <span class="text-ink-extra-muted font-medium truncate">
                  <Show
                    when={entity().durationMs}
                    fallback={entity().isActive ? 'In progress' : ''}
                  >
                    {(ms) => formatCallDuration(ms())}
                  </Show>
                </span>
              </>
            )}
          </Match>
          <Match when={isAutomationEntity(props.entity) && props.entity}>
            {(entity) => (
              <>
                <span class="w-(--title-width) shrink-0 truncate">
                  <Entity.Title entity={entity()} />
                </span>
                <span class="">
                  <AutomationSubtitle entity={entity()} />
                </span>
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
            <span class="ph-no-capture text-ink-extra-muted text-xs">
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
        <Show
          when={
            !props.hasNotifications &&
            !(isChannelEntity(props.entity) && isSearchEntity(props.entity))
          }
        >
          <Entity.Timestamp entity={props.entity} />
        </Show>
      </Entity.Slot>
    </Entity.Layout>
  );
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
          'bg-accent/5 outline-1 outline-accent/20 outline-offset-[-1px]':
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
