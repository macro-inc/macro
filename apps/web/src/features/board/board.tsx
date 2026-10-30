import type { ConversationState } from '@app/features/agents-view/core/conversation-state';
import { markCalendarNotificationSeenOnOpen } from '@app/features/calendar/mark-event-notifications-seen';
import {
  markChannelNotificationsSeenOnOpen,
  openEntityInSplitFromUnifiedList,
} from '@app/features/next-soup/utils';
import { t } from '@app/lib/i18n';
import { createSearchParams } from '@app/lib/split-router';
import { createPreviewSelectionGuard } from '@components/app/createPreviewSelectionGuard';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import {
  type PreviewPanelSelection,
  previewBlockTarget,
} from '@components/app/previewTarget';
import {
  useSplitDisplayName,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { UserIcon } from '@core/component/UserIcon';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { getDisplayName, getInitialsFromName, tryMacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import {
  type EntityData,
  type GithubPullRequestEntity,
  isNonMemberChannelEntity,
  ListEntityMetadataQueryProvider,
  type WithNotification,
} from '@entity';
import { getBotDisplayName } from '@queries/messages/message-sender';
import { Avatar } from '@ui';
import { Result } from 'neverthrow';
import { createSignal, Match, onCleanup, onMount, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { boardSearch } from './board-search';
import {
  type BoardCapabilities,
  BoardProvider,
  type BoardStorage,
} from './context/board-context';
import type { BoardAuthor } from './core/item';
import type { BoardItemResolvers } from './queries/entity-board-items';
import { createHomeBoardSource } from './queries/home-board-source';
import { BoardView } from './views/board-view';

const MEMORY = createUserScopedStorage('macro:board:v1');

const parseMemory = Result.fromThrowable(
  (raw: string): unknown => JSON.parse(raw),
  () => undefined
);

const localPart = (id: string) =>
  id.replace(/^macro\|/, '').split('@')[0] || id;

/** What an agent run is doing, when it is doing anything. */
function agentStatus(state: ConversationState): string | undefined {
  return match(state)
    .with('starting', () => t('board.agentStarting'))
    .with('working', () => t('board.agentWorking'))
    .with('waiting', () => t('board.agentWaiting'))
    .with('dormant', () => undefined)
    .exhaustive();
}

function pullRequestStatus(
  state: GithubPullRequestEntity['metadata']['status']
): string | undefined {
  return match(state)
    .with('open', () => t('board.pullRequestOpen'))
    .with('merged', () => t('board.pullRequestMerged'))
    .with('closed', () => t('board.pullRequestClosed'))
    .exhaustive(() => undefined);
}

/** Profile pictures for Macro users and contacts, marks for agents. */
function BoardAvatar(props: { author: BoardAuthor; size: number }) {
  const initials = () =>
    getInitialsFromName(props.author.name, props.author.id);
  return (
    <span
      class="block shrink-0"
      style={{ width: `${props.size}px`, height: `${props.size}px` }}
    >
      <Switch
        fallback={
          <Avatar size="fill">
            <Avatar.Image src={props.author.avatarUrl ?? ''} alt="" />
            <Avatar.Fallback>{initials()}</Avatar.Fallback>
          </Avatar>
        }
      >
        <Match when={props.author.kind === 'person'}>
          <UserIcon id={props.author.id} size="fill" suppressClick />
        </Match>
        <Match
          when={
            props.author.kind === 'contact' && props.author.id.includes('@')
          }
        >
          <UserIcon email={props.author.id} size="fill" suppressClick />
        </Match>
      </Switch>
    </span>
  );
}

/** Calendar events open the Calendar view, so only blocks preview in place. */
function previewSelection(
  entity: WithNotification<EntityData> | undefined
): PreviewPanelSelection | undefined {
  if (!entity) return undefined;
  if (entity.type === 'calendar_event' || entity.type === 'initiative') return;
  return entity;
}

/** The item's block, as Home's inline preview shows it. */
function BoardDetail(props: { selection: PreviewPanelSelection | undefined }) {
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  return (
    <PreviewPanel
      target={props.selection && previewBlockTarget(props.selection)}
      selectedEntity={props.selection}
      orchestrator={orchestrator}
      splitPanelContext={panel}
    />
  );
}

/**
 * The Board in a split: Home's feed as a board, its variant kept in the
 * URL. Items open in a modal over the board through the same block preview
 * Home uses; content already open in another split is focused there instead.
 */
export function BoardEntry() {
  const panel = useSplitPanelOrThrow();
  const notificationSource = useGlobalNotificationSource();
  const userId = useUserId();
  const channels = useChannelsContext();
  const [search, setSearch] = createSearchParams(boardSearch);
  const home = createHomeBoardSource(
    (): BoardItemResolvers => ({
      viewerId: userId(),
      userName: (id) =>
        getDisplayName(tryMacroId(id), { emailFallback: 'local-part' }) ||
        localPart(id),
      botName: (id) => getBotDisplayName(id),
      channelName: (id, fallback) =>
        channels.channelsById()[id]?.name?.trim() || fallback,
      updatedText: t('board.updated'),
      threadContext: (channel) => t('board.threadIn', { channel }),
      agentStatus,
      pullRequestStatus,
    })
  );
  const selectPreview = createPreviewSelectionGuard();
  useSplitDisplayName(() => t('board.title'));

  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    onCleanup(() => clearInterval(clock));
  });

  const storage: BoardStorage = {
    read: () => {
      const id = userId();
      const raw = id ? MEMORY.read(id) : null;
      return raw ? parseMemory(raw).unwrapOr(undefined) : undefined;
    },
    write: (value) => {
      const id = userId();
      if (id) MEMORY.write(id, JSON.stringify(value));
    },
  };

  const markSeen = (entity: WithNotification<EntityData>) => {
    markCalendarNotificationSeenOnOpen(entity, notificationSource);
    if (!isNonMemberChannelEntity(entity)) {
      markChannelNotificationsSeenOnOpen(entity, notificationSource);
    }
  };

  const openInSplit = (key: string, options: { newSplit: boolean }) => {
    const entity = home.entity(key);
    if (!entity) return;
    fireAndForget(
      openEntityInSplitFromUnifiedList(entity, {
        openInNewSplit: options.newSplit,
        splitHandle: panel.handle,
        referredFrom: 'board',
      }),
      'board'
    );
  };

  const capabilities: BoardCapabilities = {
    source: home.source,
    now,
    storage,
    Avatar: BoardAvatar,
    Detail: (props) => (
      <BoardDetail selection={previewSelection(home.entity(props.itemKey))} />
    ),
    open: (key) => {
      const entity = home.entity(key);
      if (!entity) return 'elsewhere';
      markSeen(entity);
      const selection = previewSelection(entity);
      if (!selection) {
        openInSplit(key, { newSplit: false });
        return 'elsewhere';
      }
      // Already open in another split: the guard focuses it there.
      return selectPreview(selection) ? 'modal' : 'elsewhere';
    },
    close: () => {
      selectPreview(undefined);
    },
    openInSplit,
  };

  return (
    <ListEntityMetadataQueryProvider>
      <StaticMarkdownContext>
        <SplitPanel.Root>
          <SplitPanel.Body>
            <BoardProvider value={capabilities}>
              <BoardView
                variant={search.variant}
                onVariantChange={(variant) =>
                  setSearch({ variant }, { history: 'replace' })
                }
                hotkeys={{
                  scopeId: panel.splitHotkeyScope,
                  enabled: panel.isPanelActive,
                }}
              />
            </BoardProvider>
          </SplitPanel.Body>
        </SplitPanel.Root>
      </StaticMarkdownContext>
    </ListEntityMetadataQueryProvider>
  );
}
