import { activeAppLayout } from '@app/features/app-layout/layout-state';
import {
  splitChromeIsTinted,
  splitOwnsIdentity,
} from '@app/features/app-layout/split-chrome';
import { SoupChatInput } from '@app/features/chat/SoupChatInput';
import { createSoupState } from '@app/features/next-soup/create-soup-state';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { SoupContextProvider } from '@app/features/next-soup/soup-context';
import { SoupEntityContextMenu } from '@app/features/next-soup/soup-view/soup-entity-context-menu';
import {
  SoupViewContextProvider,
  useSoupView,
} from '@app/features/next-soup/soup-view/soup-view-context';
import { useApplyPreset } from '@app/features/next-soup/soup-view/soup-view-tabs';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  MAX_MESSAGES_SIDEBAR_WIDTH,
  MIN_MESSAGES_SIDEBAR_WIDTH,
  messagesSidebarWidth,
  setMessagesSidebarWidth,
} from '@components/app/split-layout/messagesSidebarWidth';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { Resize, ResizeZoneContext } from '@core/component/Resize/Resize';
import { useUserContext } from '@core/context/user';
import { createBlockInstance } from '@core/orchestrator';
import {
  Entity,
  type EntityData,
  isCallEntity,
  isChannelEntity,
  isChannelMessageEntity,
  isChannelThreadEntity,
  isChatEntity,
  isEmailEntity,
  isTaskEntity,
  unreadFilterFn,
  type WithNotification,
} from '@entity';
import BellIcon from '@phosphor/bell.svg';
import BuildingsIcon from '@phosphor/buildings.svg';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import ChatIcon from '@phosphor/chats-circle.svg';
import EmailIcon from '@phosphor/envelope-simple.svg';
import TasksIcon from '@phosphor/list-checks.svg';
import DriveIcon from '@phosphor/shipping-container.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import { cn } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  Show,
  Switch,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

type InboxCategory = 'signal' | 'noise' | 'all';

const INBOX_CATEGORIES: readonly { id: InboxCategory; label: string }[] = [
  { id: 'signal', label: 'Signal' },
  { id: 'noise', label: 'Noise' },
  { id: 'all', label: 'All' },
];

const initialInboxPreset = getViewPreset('inbox', 'signal');
const INBOX_SIDEBAR_PANEL_ID = 'experimental-inbox-sidebar';
const INBOX_PREVIEW_PANEL_ID = 'experimental-inbox-preview';

function inboxEntityKey(entity: EntityData) {
  return `${entity.type}:${entity.id}`;
}

/** Sidebar destination glyphs so a mixed inbox can be scanned by type. */
function inboxEntityTypeIcon(entity: EntityData) {
  if (isEmailEntity(entity)) return EmailIcon;
  if (
    isChannelEntity(entity) ||
    isChannelMessageEntity(entity) ||
    isChannelThreadEntity(entity)
  ) {
    return ChatIcon;
  }
  if (isChatEntity(entity)) return SparkleIcon;
  if (isTaskEntity(entity)) return TasksIcon;
  if (isCallEntity(entity) || entity.type === 'calendar_event') {
    return CalendarIcon;
  }
  if (entity.type === 'reminder') return BellIcon;
  if (entity.type === 'crm_company' || entity.type === 'crm_contact') {
    return BuildingsIcon;
  }
  return DriveIcon;
}

function InboxHistoryItem(props: {
  entity: WithNotification<EntityData>;
  active: boolean;
  onSelect: () => void;
}) {
  const unread = () => unreadFilterFn(props.entity);

  return (
    <SoupEntityContextMenu entity={props.entity}>
      <button
        type="button"
        class={cn(
          'group/inbox flex w-full shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left outline-none transition-colors',
          props.active
            ? 'bg-active text-ink'
            : 'text-ink-muted hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40'
        )}
        aria-current={props.active ? 'true' : undefined}
        onClick={props.onSelect}
      >
      <span class="flex size-4 shrink-0 items-center justify-center">
        <Dynamic
          component={inboxEntityTypeIcon(props.entity)}
          class="size-4"
        />
      </span>
      <span class="min-w-0 flex-1 truncate text-sm font-medium">
        <Entity.Title entity={props.entity} />
      </span>
      <span class="flex shrink-0 items-center">
        <span
          class={cn(
            'overflow-hidden whitespace-nowrap text-xs font-light text-ink-extra-muted transition-[max-width,opacity,margin]',
            props.active
              ? 'ml-2 max-w-24 opacity-100'
              : 'max-w-0 opacity-0 group-hover/inbox:ml-2 group-hover/inbox:max-w-24 group-hover/inbox:opacity-100'
          )}
        >
          <Entity.Timestamp entity={props.entity} />
        </span>
        <Show when={unread()}>
          <span
            role="img"
            aria-label="Unread"
            class="ml-2 size-2 shrink-0 rounded-full bg-accent"
          />
        </Show>
      </span>
    </button>
    </SoupEntityContextMenu>
  );
}

/** Inbox cards and an inline item preview, without a controller preview split. */
export function ExperimentalInboxWorkspace() {
  const soup = createSoupState();

  return (
    <SoupContextProvider soup={soup}>
      <SoupViewContextProvider
        soup={soup}
        initialEnabled
        initialQuery={initialInboxPreset?.filters}
        initialClientFilters={initialInboxPreset?.clientFilters}
        preferInitialFilters
      >
        <InboxWorkspaceContent />
      </SoupViewContextProvider>
    </SoupContextProvider>
  );
}

function SyncInboxSidebarWidth() {
  const resizeZone = useContext(ResizeZoneContext);
  if (!resizeZone) return null;
  const size = resizeZone.sizeOf(INBOX_SIDEBAR_PANEL_ID);
  createEffect(() => {
    const width = size();
    if (width > 0) setMessagesSidebarWidth(width);
  });
  return null;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function InboxWorkspaceContent() {
  const soupView = useSoupView();
  const orchestrator = useGlobalBlockOrchestrator();
  const splitPanelContext = useSplitPanelOrThrow();
  const { applyTabPreset } = useApplyPreset();
  const user = useUserContext();
  const [category, setCategory] = createSignal<InboxCategory>('signal');

  const firstName = () => {
    const name = user.author();
    return name.includes('@') ? name.split('@')[0] : name.split(' ')[0];
  };

  /** Focused layouts split the inbox into Signal and Noise only — no All. */
  const visibleCategories = () =>
    activeAppLayout().capabilities.focusedInboxTabs
      ? INBOX_CATEGORIES.filter((item) => item.id !== 'all')
      : INBOX_CATEGORIES;

  // Switching layouts can strand the state on the hidden tab.
  createEffect(() => {
    if (visibleCategories().some((item) => item.id === category())) return;
    selectCategory('signal');
  });
  const [selectedKey, setSelectedKey] = createSignal<string>();
  const [homeChatId, setHomeChatId] = createSignal<string>();
  const entities = () => soupView.items();
  const selectedEntity = createMemo(() =>
    entities().find((entity) => inboxEntityKey(entity) === selectedKey())
  );
  const homeChatBlock = createMemo(() => {
    const id = homeChatId();
    return id ? createBlockInstance('chat', id) : undefined;
  });
  // Drop a selection that left the list (tab change, filters) rather than
  // auto-opening the next row — the empty state is the AI composer.
  createEffect(() => {
    const key = selectedKey();
    if (!key) return;
    if (entities().some((entity) => inboxEntityKey(entity) === key)) return;
    setSelectedKey(undefined);
  });

  const selectCategory = (next: InboxCategory) => {
    applyTabPreset('inbox', next);
    setCategory(next);
    setSelectedKey(undefined);
    setHomeChatId(undefined);
  };

  const selectEntity = (key: string) => {
    setHomeChatId(undefined);
    setSelectedKey(key);
  };

  return (
    <StaticMarkdownContext>
      <Resize.Zone direction="horizontal" gutter={8} class="overflow-hidden">
        <Resize.Panel
          id={INBOX_SIDEBAR_PANEL_ID}
          index={0}
          minSize={MIN_MESSAGES_SIDEBAR_WIDTH}
          maxSize={MAX_MESSAGES_SIDEBAR_WIDTH}
          redistributionPreferredSize={messagesSidebarWidth()}
          target={{ kind: 'px', px: messagesSidebarWidth() }}
        >
          <section
            class={cn(
              'flex size-full min-h-0 flex-col border-r border-edge-muted pb-5',
              splitChromeIsTinted() && 'bg-ink/2',
              // Clears the absolutely-positioned workspace header, which is
              // shorter once it drops its split controls.
              splitOwnsIdentity() ? 'pt-[5.75rem]' : 'pt-[3.75rem]'
            )}
          >
            <div
              class={cn(
                'mx-4 mt-3 grid h-9 shrink-0 gap-1 rounded-xl bg-ink/4 p-1',
                visibleCategories().length === 2 ? 'grid-cols-2' : 'grid-cols-3'
              )}
              role="tablist"
              aria-label="Inbox views"
            >
              <For each={visibleCategories()}>
                {(item) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={category() === item.id}
                    class={cn(
                      'flex min-w-0 items-center justify-center rounded-lg px-2 text-xs font-medium transition-colors',
                      category() === item.id
                        ? 'bg-surface text-ink shadow-sm'
                        : 'text-ink-muted hover:text-ink'
                    )}
                    aria-pressed={category() === item.id}
                    onClick={() => selectCategory(item.id)}
                  >
                    {item.label}
                  </button>
                )}
              </For>
            </div>
            <div class="scrollbar-hidden mt-3 min-h-0 flex-1 overflow-y-auto">
              <Show
                when={entities().length > 0}
                fallback={
                  <p class="m-0 px-3 py-8 text-center text-sm text-ink-extra-muted">
                    {soupView.source.isLoading()
                      ? 'Loading inbox…'
                      : 'Nothing in this inbox.'}
                  </p>
                }
              >
                <div class="flex flex-col gap-0.5 px-2">
                  <For each={entities()}>
                    {(entity) => {
                      const key = () => inboxEntityKey(entity);
                      return (
                        <InboxHistoryItem
                          entity={entity as WithNotification<EntityData>}
                          active={selectedKey() === key()}
                          onSelect={() => selectEntity(key())}
                        />
                      );
                    }}
                  </For>
                </div>
              </Show>
            </div>
          </section>
        </Resize.Panel>

        <Resize.Panel id={INBOX_PREVIEW_PANEL_ID} index={1} minSize={320}>
          <section class="size-full min-h-0 min-w-0">
            <Switch>
              <Match when={selectedEntity()}>
                {(entity) => (
                  <div class="size-full min-h-0 overflow-hidden">
                    <PreviewPanel
                      selectedEntity={entity()}
                      orchestrator={orchestrator}
                      splitPanelContext={splitPanelContext}
                    />
                  </div>
                )}
              </Match>
              <Match when={homeChatBlock()}>
                {(block) => (
                  <div class="size-full min-h-0">
                    <Dynamic component={block().element} />
                  </div>
                )}
              </Match>
              <Match when={true}>
                <div class="flex size-full min-h-0 flex-col items-center justify-center px-6 pb-[12vh]">
                  <div class="flex w-full max-w-3xl flex-col items-center gap-6">
                    <h1 class="m-0 text-center text-3xl font-medium tracking-tight text-ink">
                      {getGreeting()},{' '}
                      <span class="capitalize">{firstName()}</span>
                    </h1>
                    <div class="w-full">
                      <SoupChatInput
                        placement="centered"
                        variant="tall"
                        onChatCreated={setHomeChatId}
                      />
                    </div>
                  </div>
                </div>
              </Match>
            </Switch>
          </section>
        </Resize.Panel>
        <SyncInboxSidebarWidth />
      </Resize.Zone>
    </StaticMarkdownContext>
  );
}
