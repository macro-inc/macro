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
import { useUserId } from '@core/context/user';
import { getInitialsFromName } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import {
  type EntityData,
  isNonMemberChannelEntity,
  ListEntityMetadataQueryProvider,
  type WithNotification,
} from '@entity';
import { Avatar } from '@ui';
import { createSignal, Match, onCleanup, onMount, Switch } from 'solid-js';
import { boardSearch } from './board-search';
import {
  type BoardCapabilities,
  BoardProvider,
  type BoardStorage,
} from './context/board-context';
import type { BoardAuthor } from './core/item';
import { createHomeBoardSource } from './queries/home-board-source';
import { BoardView } from './views/board-view';

const MEMORY = createUserScopedStorage('macro:board:v1');

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
  const [search, setSearch] = createSearchParams(boardSearch);
  const home = createHomeBoardSource();
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
      if (!raw) return undefined;
      try {
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
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
