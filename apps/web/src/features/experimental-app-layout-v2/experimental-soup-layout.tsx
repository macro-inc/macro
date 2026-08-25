import type { ListView } from '@app/constants/list-views';
import {
  describeSchedule,
  getDefaultTimezone,
  parseCron,
} from '@app/features/block-automation/component/automationUtils';
import {
  defineQueryFilters,
  NIL_UUID,
} from '@app/features/next-soup/filters/filter-store';
import { InboxSelector } from '@app/features/next-soup/soup-view/filters-bar/inbox-selector';
import { SoupViewContextGroup } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-group';
import { SoupViewContextSort } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-sort';
import { SoupSearchbar } from '@app/features/next-soup/soup-view/filters-bar/soup-view-search-bar';
import { UnifiedFilterDropdown } from '@app/features/next-soup/soup-view/filters-bar/unified-filter-dropdown';
import { useFilterRefinements } from '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements';
import {
  buildDocumentTypeQuery,
  getActiveDocumentTypeFilterIds,
  isDocumentTypeFilterId,
} from '@app/features/next-soup/filters/configs/document-type-query';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { SoupViewCreateButton } from '@app/features/next-soup/soup-view/soup-view-create-button';
import { useApplyPreset } from '@app/features/next-soup/soup-view/soup-view-tabs';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { VIEW_TAB_LISTS } from '@app/features/next-soup/soup-view/tab-lists';
import {
  CompanyDisplayMenu,
  CompanyViewsMenu,
} from '@app/features/next-soup/soup-view/views/companies/CompanyViewsMenu';
import {
  BRAIN_WORKSPACE_ENTRY_STATE_KEY,
  type BrainWorkspaceSelection,
  type BrainWorkspaceTab,
  buildBrainWorkspacePath,
  getLastBrainWorkspaceSelection,
  isBrainWorkspaceSelection,
  parseBrainWorkspaceRoute,
  rememberBrainWorkspaceSelection,
} from '@components/app/split-layout/brainWorkspaceRoute';
import {
  parseChannelsWorkspaceRoute,
  serializeChannelsWorkspacePath,
} from '@components/app/split-layout/channelsWorkspaceRoute';
import { SidePanel } from '@components/app/side-panel';
import { PreviewButton } from '@components/app/split-layout/components/PreviewButton';
import { ComposedSplitControls } from '@components/app/split-layout/composed/ComposedSplitControls';
import { ComposedSplitHeader } from '@components/app/split-layout/composed/ComposedSplitHeader';
import { SplitLayoutContext } from '@components/app/split-layout/context';
import { Entity } from '@entity';
import type { ChatEntity } from '@entity/types/entity';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { DOCS_BASE, LIST_VIEW_DOCS_URL } from '@app/constants/docs-links';
import { useUserId } from '@core/context/user';
import { TOKENS } from '@core/hotkey/tokens';
import { createBlockInstance } from '@core/orchestrator';
import SkillIcon from '@icon/skill.svg';
import WideAutomationIcon from '@icon/wide-automation.svg';
import PdfAppIcon from '@icon/wide-book.svg';
import CodeAppIcon from '@icon/wide-file-code.svg';
import ImageAppIcon from '@icon/wide-file-image.svg';
import DocumentAppIcon from '@icon/wide-file-md.svg';
import CanvasAppIcon from '@icon/wide-diagram.svg';
import VideoAppIcon from '@icon/wide-video.svg';
import NoiseIcon from '@icon/wide-noise.svg';
import SignalIcon from '@icon/wide-signal.svg';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import ExpandIcon from '@phosphor/arrows-out.svg';
import BrainIcon from '@phosphor/brain.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import ClockIcon from '@phosphor/clock-counter-clockwise.svg';
import EnvelopeOpenIcon from '@phosphor/envelope-open.svg';
import FilterIcon from '@phosphor/funnel-simple.svg';
import FolderIcon from '@phosphor/folder-simple.svg';
import MenuIcon from '@phosphor/list.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import NoteIcon from '@phosphor/note-pencil.svg';
import PaperPlaneIcon from '@phosphor/paper-plane-tilt.svg';
import PlugIcon from '@phosphor/plug.svg';
import SquaresIcon from '@phosphor/squares-four.svg';
import ShareIcon from '@phosphor/share-network.svg';
import RecordIcon from '@phosphor/record.svg';
import UsersIcon from '@phosphor/users-three.svg';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { useSoupItemsQuery } from '@queries/soup/items';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { useNavigate, useParams } from '@solidjs/router';
import XIcon from '@phosphor/x.svg';
import {
  Button,
  Checkbox,
  cn,
  Dropdown,
  HorizontalScrollArea,
  Tooltip,
} from '@ui';
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  CHAT_HISTORY_QUERY,
  ChatWorkspaceMain,
  ExperimentalChatHistoryItem,
  isChatEntity,
} from './experimental-chat-view';
import { ExperimentalDriveFavoritesSection } from './experimental-drive-favorites-section';
import { ExperimentalDriveTreeSection } from './experimental-drive-tree-section';
import {
  ExperimentalIntegrationDetails,
  ExperimentalIntegrationIcon,
  ExperimentalIntegrationsView,
} from './experimental-integrations-view';
import {
  CoreBadge,
  ExperimentalMemoriesView,
  ExperimentalMemoryDetails,
} from './experimental-memories-view';
import { ExperimentalMessagesRail } from './experimental-messages-rail';
import {
  ExperimentalPowersDetailsContext,
  type ExperimentalPowersDetail,
} from './experimental-powers-details-context';
import {
  ExperimentalViewSidebar,
  ExperimentalViewSidebarItems,
} from './experimental-view-sidebar';

export type ExperimentalSoupView =
  | 'inbox'
  | 'email'
  | 'library'
  | 'machines'
  | 'tasks'
  | 'messages'
  | 'crm';

const VIEW_TITLES: Record<ExperimentalSoupView, string> = {
  inbox: 'Inbox',
  email: 'Email',
  library: 'Drive',
  machines: 'Brain',
  tasks: 'Tasks',
  messages: 'Chat',
  crm: 'CRM',
};

type ViewNavigationItem = {
  value: string;
  label: string;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
};

const INBOX_ITEMS: readonly ViewNavigationItem[] = [
  { value: 'signal', label: 'Signal', icon: SignalIcon },
  { value: 'noise', label: 'Noise', icon: NoiseIcon },
  { value: 'all', label: 'All', icon: SquaresIcon },
];

const TASK_PERSONAL_ITEMS: readonly ViewNavigationItem[] = [
  { value: 'my-tasks', label: 'My tasks', icon: RecordIcon },
  { value: 'created-by-me', label: 'Created by me', icon: NoteIcon },
  { value: 'projects', label: 'Projects', icon: FolderIcon },
];

const TASK_TEAM_ITEMS: readonly ViewNavigationItem[] = [
  { value: 'team-tasks', label: 'Team tasks', icon: RecordIcon },
];

type PowersTab =
  | 'agents'
  | 'automations'
  | 'skills'
  | 'integrations'
  | 'memories';

function powersTabFromRoute(tab: BrainWorkspaceTab): PowersTab {
  if (tab === 'routines') return 'automations';
  if (tab === 'memory') return 'memories';
  return tab;
}

function routeTabFromPowers(tab: PowersTab): BrainWorkspaceTab | undefined {
  if (tab === 'automations') return 'routines';
  if (tab === 'memories') return 'memory';
  if (tab === 'agents') return undefined;
  return tab;
}

const MACHINE_ITEMS: readonly (ViewNavigationItem & { value: PowersTab })[] = [
  { value: 'agents', label: 'Agents', icon: BrainIcon },
  { value: 'automations', label: 'Routines', icon: WideAutomationIcon },
  { value: 'skills', label: 'Skills', icon: SkillIcon },
  { value: 'integrations', label: 'Integrations', icon: PlugIcon },
  { value: 'memories', label: 'Memory', icon: NoteIcon },
];

const POWERS_TAB_DESCRIPTIONS: Record<PowersTab, readonly string[]> = {
  agents: [
    'Agents are reusable collaborators configured for focused kinds of work.',
    'Create and manage them here alongside the routines and context they use.',
  ],
  automations: [
    'Automations let Macro run recurring instructions on a schedule.',
    'Use them for repeatable workflows, then review their timing and status here.',
  ],
  skills: [
    'Skills teach Macro how to perform specialized work consistently.',
    'Create them for tasks you repeat and reuse them whenever you work with Macro.',
  ],
  integrations: [
    'Integrations connect Macro to the services where your work already lives.',
    'Connect an account, review its access, and manage each connection here.',
  ],
  memories: [
    'Memories contain context Macro has learned about you and your work.',
    'Review them periodically to understand what Macro can use in its responses.',
  ],
};

const POWERS_TAB_CHECKLISTS: Record<PowersTab, readonly string[]> = {
  agents: [
    'Create an agent for a focused workflow',
    'Give it clear instructions and context',
    'Start a conversation and refine its behavior',
  ],
  automations: [
    'Create your first automation',
    'Add a clear instruction and schedule',
    'Enable it and review the next run',
  ],
  skills: [
    'Create a skill for a repeatable task',
    'Add focused, reusable instructions',
    'Use the skill while working with Macro',
  ],
  integrations: [
    'Choose a service your workflow depends on',
    'Connect and authorize an account',
    'Review access and enable the connection',
  ],
  memories: [
    'Open your core context',
    'Review what Macro remembers',
    'Return as your work and preferences change',
  ],
};

const POWERS_TAB_DOCS_URLS: Record<PowersTab, string> = {
  agents: LIST_VIEW_DOCS_URL.agents ?? DOCS_BASE,
  automations: LIST_VIEW_DOCS_URL.agents ?? DOCS_BASE,
  skills: LIST_VIEW_DOCS_URL.agents ?? DOCS_BASE,
  integrations: DOCS_BASE,
  memories: DOCS_BASE,
};

const EMAIL_TAB_ICONS: Record<
  string,
  Component<JSX.SvgSVGAttributes<SVGSVGElement>>
> = {
  important: SignalIcon,
  noise: NoiseIcon,
  sent: PaperPlaneIcon,
  drafts: NoteIcon,
  shared: ShareIcon,
  all: EnvelopeOpenIcon,
};

type LibrarySection =
  | 'recents'
  | 'my-drive'
  | 'favorites'
  | 'shared'
  | 'images'
  | 'all';

const LIBRARY_ITEMS: readonly (ViewNavigationItem & {
  value: LibrarySection;
})[] = [
  { value: 'recents', label: 'Recents', icon: ClockIcon },
  { value: 'shared', label: 'Shared with me', icon: ShareIcon },
  { value: 'all', label: 'Everything', icon: SquaresIcon },
];

const LIBRARY_TYPE_FILTERS = [
  { id: 'doc-markdown', label: 'Documents', icon: DocumentAppIcon },
  { id: 'file-image', label: 'Images', icon: ImageAppIcon },
  { id: 'file-pdf', label: 'PDFs', icon: PdfAppIcon },
  { id: 'file-code', label: 'Code', icon: CodeAppIcon },
  { id: 'file-video', label: 'Videos', icon: VideoAppIcon },
  { id: 'doc-canvas', label: 'Canvases', icon: CanvasAppIcon },
] as const;

const TAB_VIEW_BY_EXPERIMENTAL_VIEW: Partial<
  Record<ExperimentalSoupView, 'inbox' | 'mail' | 'agents' | 'tasks'>
> = {
  inbox: 'inbox',
  email: 'mail',
  machines: 'agents',
  tasks: 'tasks',
};

type ExperimentalSoupLayoutProps = {
  view: ExperimentalSoupView;
  initialSearchText?: string;
  hasPreviewItems: boolean;
  onPreviewEngage: () => void;
  onPreviewOpenChange?: (open: boolean) => void;
  children: JSX.Element;
};

/**
 * Alternate desktop composition for soup-backed app views. It deliberately
 * owns only chrome; query, row, action, and empty-state behavior stays in the
 * existing SoupView children.
 */
export function ExperimentalSoupLayout(props: ExperimentalSoupLayoutProps) {
  const panel = useSplitPanelOrThrow();
  const userId = useUserId();
  const layout = useContext(SplitLayoutContext);
  const navigate = useNavigate();
  const params = useParams<{
    brainPath?: string;
    channelsPath?: string;
  }>();
  const soupView = useSoupView();
  const { applyTabPreset } = useApplyPreset();
  const brainRoute = createMemo(() =>
    parseBrainWorkspaceRoute(params.brainPath)
  );
  const entryBrainSelection = (() => {
    const value = panel.handle.currentEntryState()?.[
      BRAIN_WORKSPACE_ENTRY_STATE_KEY
    ];
    return isBrainWorkspaceSelection(value) ? value : undefined;
  })();
  const isPrimaryPanel = () =>
    layout?.manager.splits()[0]?.id === panel.handle.id;
  const initialBrainSelection =
    (isPrimaryPanel() ? brainRoute().selection : undefined) ??
    entryBrainSelection ??
    getLastBrainWorkspaceSelection();
  const [powersTab, setPowersTab] = createSignal<PowersTab>(
    initialBrainSelection?.kind === 'tab'
      ? powersTabFromRoute(initialBrainSelection.tab)
      : initialBrainSelection?.kind === 'chat'
        ? 'agents'
        : soupView.activeTab() === 'skills'
          ? 'skills'
          : soupView.activeTab() === 'automations'
            ? 'automations'
            : 'agents'
  );
  const [powersDetail, setPowersDetail] =
    createSignal<ExperimentalPowersDetail>();
  const chatsQuery = useSoupItemsQuery(
    () => CHAT_HISTORY_QUERY,
    () => ({ enabled: props.view === 'machines' })
  );
  const [brainChatSearch, setBrainChatSearch] = createSignal('');
  const [selectedBrainChatId, setSelectedBrainChatId] =
    createSignal<string | undefined>(
      initialBrainSelection?.kind === 'chat'
        ? initialBrainSelection.chatId
        : undefined
    );
  const brainChats = createMemo<ChatEntity[]>(() =>
    (chatsQuery.data ?? []).filter(isChatEntity)
  );
  const visibleBrainChats = createMemo(() => {
    const query = brainChatSearch().trim().toLocaleLowerCase();
    if (!query) return brainChats();
    return brainChats().filter((chat) =>
      chat.name.toLocaleLowerCase().includes(query)
    );
  });
  const selectedBrainChatBlock = createMemo(() => {
    const chatId = selectedBrainChatId();
    return chatId ? createBlockInstance('chat', chatId) : undefined;
  });
  const [viewMenuOpen, setViewMenuOpen] = createSignal(false);
  const [viewSidebarCollapsed, setViewSidebarCollapsed] = createSignal(false);
  const [taskTeamExpanded, setTaskTeamExpanded] = createSignal(true);
  const currentTeamQuery = useCurrentTeamQuery();
  const taskTeamName = () => currentTeamQuery.data?.team.name ?? 'Team';
  const { consolidatedFiltersList, resetToTabDefaults } =
    useFilterRefinements();
  const activeFilterCount = createMemo(() =>
    consolidatedFiltersList().reduce(
      (count, filter) => count + Math.max(filter.values().length, 1),
      0
    )
  );

  const searchPlaceholder = createMemo(() => {
    if (props.view === 'inbox') return 'Search inbox';
    if (props.view === 'email') return 'Search email';
    if (props.view === 'library') return 'Search drive';
    if (props.view === 'tasks') return 'Search tasks';
    if (props.view === 'crm') return 'Search CRM';
    if (props.view === 'machines') {
      if (powersTab() === 'agents') return 'Search agents';
      if (powersTab() === 'skills') return 'Search skills';
      return 'Search routines';
    }
    return 'Search';
  });

  const tabView = () => TAB_VIEW_BY_EXPERIMENTAL_VIEW[props.view];
  const emailTabs = () =>
    VIEW_TAB_LISTS.mail.filter((tab) => tab.value !== 'calendar');

  const selectTab = (value: string) => {
    const view = tabView();
    if (view) applyTabPreset(view, value);
  };

  const currentBrainSelection = (): BrainWorkspaceSelection | undefined => {
    const chatId = selectedBrainChatId();
    if (chatId) return { kind: 'chat', chatId };
    const tab = routeTabFromPowers(powersTab());
    return tab ? { kind: 'tab', tab } : undefined;
  };

  const syncBrainSelection = () => {
    const selection = currentBrainSelection();
    if (isPrimaryPanel()) {
      rememberBrainWorkspaceSelection(selection);
      const path = buildBrainWorkspacePath(
        selection,
        brainRoute().splitSegments
      );
      window.history.replaceState(
        window.history.state,
        '',
        `${path}${window.location.search}${window.location.hash}`
      );
    }
  };

  const selectPowersTab = (value: PowersTab) => {
    setPowersDetail(undefined);
    setSelectedBrainChatId(undefined);
    setPowersTab(value);
    if (value === 'agents') {
      applyTabPreset('agents', 'owned');
    } else if (value === 'automations' || value === 'skills') {
      applyTabPreset('agents', value);
    }
    syncBrainSelection();
  };

  const selectBrainChat = (chatId: string) => {
    setPowersDetail(undefined);
    setPowersTab('agents');
    setSelectedBrainChatId(chatId);
    syncBrainSelection();
  };

  const startBrainChat = () => {
    setPowersDetail(undefined);
    setPowersTab('agents');
    setSelectedBrainChatId(undefined);
    syncBrainSelection();
  };

  const initialLibrarySection = (): LibrarySection | undefined => {
    if (soupView.soup.predicates.isActive('file-image')) return 'images';
    const active = soupView.activeTab();
    if (
      active === 'all' &&
      soupView.soup.sort.active()[0]?.id === 'viewed_at'
    ) {
      return 'recents';
    }
    if (active === 'drive:recents') return 'recents';
    if (active === 'drive:owned') return 'my-drive';
    if (active === 'drive:favorites') return 'favorites';
    if (active === 'drive:shared') return 'shared';
    if (active === 'drive:all') return 'all';
    if (active === 'shared' || active === 'all') return active;
    if (active?.startsWith('project:')) return undefined;
    return 'recents';
  };
  const initialLibraryProjectId = () => {
    const active = soupView.activeTab();
    return active?.startsWith('project:')
      ? active.slice('project:'.length)
      : undefined;
  };
  const [librarySection, setLibrarySection] =
    createSignal<LibrarySection | undefined>(initialLibrarySection());
  const [selectedLibraryProjectId, setSelectedLibraryProjectId] = createSignal<
    string | undefined
  >(initialLibraryProjectId());

  const clearLibraryImageFilter = () => {
    const imageQuery = buildDocumentTypeQuery(['file-image']);
    if (imageQuery) soupView.queryFilters.remove(imageQuery);
    soupView.soup.predicates.set(({ andIds, orIds }) => ({
      and: andIds.filter((id) => id !== 'file-image'),
      or: orIds.filter((id) => id !== 'file-image'),
    }));
  };

  const setLibraryTypeFilters = (nextIds: readonly string[]) => {
    const previousIds = getActiveDocumentTypeFilterIds(
      soupView.soup.predicates.isActive
    );
    const previousQuery = buildDocumentTypeQuery(previousIds);
    const nextQuery = buildDocumentTypeQuery(nextIds);
    if (previousQuery) soupView.queryFilters.remove(previousQuery);
    if (nextQuery) soupView.queryFilters.add(nextQuery);
    soupView.soup.predicates.set(({ andIds, orIds }) => ({
      and: andIds.filter((id) => !isDocumentTypeFilterId(id)),
      or: [
        ...orIds.filter((id) => !isDocumentTypeFilterId(id)),
        ...nextIds,
      ],
    }));
  };

  const toggleLibraryTypeFilter = (filterId: string) => {
    const previousIds = getActiveDocumentTypeFilterIds(
      soupView.soup.predicates.isActive
    );
    const previousQuery = buildDocumentTypeQuery(previousIds);
    soupView.soup.predicates.toggle({ or: [filterId] });
    const nextQuery = buildDocumentTypeQuery(
      getActiveDocumentTypeFilterIds(soupView.soup.predicates.isActive)
    );
    if (previousQuery) soupView.queryFilters.remove(previousQuery);
    if (nextQuery) soupView.queryFilters.add(nextQuery);
  };

  const applyBroadLibrarySection = (
    section: Exclude<LibrarySection, 'images' | 'favorites'>
  ) => {
    applyTabPreset('search', 'all');
    const currentUserId = userId();
    if (section === 'my-drive' && currentUserId) {
      soupView.queryFilters.add(
        defineQueryFilters({
          include: {
            documentOwnerId: [currentUserId],
            chatOwnerId: [currentUserId],
            folderOwnerId: [currentUserId],
          },
        })
      );
      soupView.soup.predicates.set({
        and: ['search-supported', 'owned-entity'],
      });
    } else if (section === 'shared' && currentUserId) {
      soupView.queryFilters.add(
        defineQueryFilters({
          exclude: {
            documentOwnerId: [currentUserId],
            chatOwnerId: [currentUserId],
            folderOwnerId: [currentUserId],
          },
        })
      );
      soupView.soup.predicates.set({
        and: ['search-supported', 'shared-entity'],
      });
    }
    soupView.soup.sort.setAll([
      section === 'recents' ? 'viewed_at' : 'updated_at',
    ]);
    soupView.setActiveTab(
      section === 'my-drive' ? 'drive:owned' : `drive:${section}`
    );
  };

  const selectLibraryFavorites = (favorites: Favorite[]) => {
    const idsFor = (...types: Favorite['entityType'][]) =>
      favorites
        .filter((favorite) => types.includes(favorite.entityType))
        .map((favorite) => favorite.entityId);
    const idsOrNil = (ids: string[]) => (ids.length > 0 ? ids : [NIL_UUID]);
    const channelIds = favorites.flatMap((favorite) => {
      if (favorite.entityType === 'channel') return [favorite.entityId];
      if (favorite.entityType === 'channel_message' && favorite.channelId) {
        return [favorite.channelId];
      }
      return [];
    });

    soupView.queryFilters.replace(
      defineQueryFilters({
        include: {
          documentId: idsOrNil(idsFor('document', 'static_file')),
          calendarEventId: idsOrNil(idsFor('calendar_event')),
          threadId: idsOrNil(idsFor('email_thread')),
          channelId: idsOrNil(channelIds),
          channelThreadId: [NIL_UUID],
          chatId: idsOrNil(idsFor('chat')),
          folderId: idsOrNil(idsFor('project')),
          callId: idsOrNil(idsFor('call')),
          foreignEntityRecordId: idsOrNil(idsFor('foreign_entity')),
          crmCompanyId: idsOrNil(idsFor('crm_company')),
          reminderId: idsOrNil(idsFor('reminder')),
          includeReminders: true,
        },
        emailView: 'all',
      })
    );
    soupView.soup.predicates.clear();
    soupView.soup.grouping.setActiveGroupId(undefined);
    soupView.soup.sort.setAll(['updated_at']);
    soupView.setActiveTab('drive:favorites');
    setLibrarySection('favorites');
    setSelectedLibraryProjectId(undefined);
    setViewMenuOpen(false);
  };

  const selectLibraryProject = (projectId: string) => {
    soupView.queryFilters.replace(
      defineQueryFilters({
        include: {
          projectId: [projectId],
          chatProjectId: [projectId],
          folderId: [projectId],
          emailProjectId: [projectId],
        },
        emailView: 'all',
      })
    );
    soupView.soup.predicates.clear();
    soupView.soup.grouping.setActiveGroupId(undefined);
    soupView.soup.sort.setAll(['updated_at']);
    soupView.setActiveTab(`project:${projectId}`);
    setLibrarySection(undefined);
    setSelectedLibraryProjectId(projectId);
    setViewMenuOpen(false);
  };

  const selectLibrarySection = (section: LibrarySection) => {
    setSelectedLibraryProjectId(undefined);
    if (section === 'images') {
      applyTabPreset('documents', 'all');
      setLibraryTypeFilters(['file-image']);
      setLibrarySection('images');
      return;
    }
    if (section === 'favorites') return;

    applyBroadLibrarySection(section);
    setLibrarySection(section);
    setViewMenuOpen(false);
  };

  onMount(() => {
    if (props.view === 'machines') {
      const unregister = panel.handle.registerEntryStateCaptor(
        BRAIN_WORKSPACE_ENTRY_STATE_KEY,
        currentBrainSelection
      );
      if (isPrimaryPanel()) {
        rememberBrainWorkspaceSelection(initialBrainSelection);
      }
      onCleanup(unregister);
    }

    if (props.view === 'library') {
      const active = soupView.activeTab();
      if (['owned', 'attachments', 'folders'].includes(active ?? '')) {
        selectLibrarySection('recents');
        return;
      }
      if (active === 'shared' || active === 'all') {
        selectLibrarySection(active);
        return;
      }
    }
    if (props.view === 'messages') {
      const unregister = panel.handle.registerEntryStateCaptor(
        'channels.workspace',
        selectedMessageChannelId
      );
      onCleanup(unregister);
      applyTabPreset('channels', 'experimental-conversations');
    }
  });

  createEffect(
    on(
      () => params.brainPath,
      (brainPath) => {
        if (props.view !== 'machines' || !isPrimaryPanel()) return;
        const selection = parseBrainWorkspaceRoute(brainPath).selection;
        if (!selection) return;

        rememberBrainWorkspaceSelection(selection);
        setPowersDetail(undefined);
        if (selection.kind === 'chat') {
          setPowersTab('agents');
          setSelectedBrainChatId(selection.chatId);
          return;
        }

        const tab = powersTabFromRoute(selection.tab);
        setSelectedBrainChatId(undefined);
        setPowersTab(tab);
        if (tab === 'automations' || tab === 'skills') {
          applyTabPreset('agents', tab);
        }
      },
      { defer: true }
    )
  );

  createEffect(() => {
    if (
      props.view === 'library' &&
      librarySection() === 'images' &&
      !soupView.soup.predicates.isActive('file-image')
    ) {
      setLibrarySection('all');
    }
  });

  const messagesRoute = createMemo(() =>
    parseChannelsWorkspaceRoute(params.channelsPath)
  );
  const entryMessageChannelId = panel.handle.currentEntryState()?.[
    'channels.workspace'
  ];
  const [selectedMessageChannelId, setSelectedMessageChannelId] =
    createSignal<string | undefined>(
      (isPrimaryPanel() ? messagesRoute().selectedChannelId : undefined) ??
        (typeof entryMessageChannelId === 'string'
          ? entryMessageChannelId
          : undefined)
    );
  createEffect(
    on(
      () => params.channelsPath,
      (channelsPath) => {
        if (props.view !== 'messages' || !isPrimaryPanel()) return;
        setSelectedMessageChannelId(
          parseChannelsWorkspaceRoute(channelsPath).selectedChannelId
        );
      },
      { defer: true }
    )
  );
  const selectMessageChannel = (channelId: string) => {
    setSelectedMessageChannelId(channelId);
    if (!isPrimaryPanel()) return;
    navigate(
      serializeChannelsWorkspacePath(
        layout?.manager.getUrlSegments() ?? [],
        channelId
      )
    );
  };
  const selectedMessageChannelBlock = createMemo(() => {
    const channelId = selectedMessageChannelId();
    return channelId ? createBlockInstance('channel', channelId) : undefined;
  });

  const ExperimentalFilterControl = () => (
    <div class="flex items-center gap-1">
      <UnifiedFilterDropdown
        customTrigger={
          <Tooltip
            label={
              activeFilterCount() > 0
                ? `${activeFilterCount()} active filters`
                : 'Filter'
            }
            hotkey={TOKENS.soup.filter}
          >
            <Dropdown.Trigger
              depth={2}
              class={cn(
                'relative bg-surface',
                activeFilterCount() > 0 && 'bg-active text-ink'
              )}
              aria-label={
                activeFilterCount() > 0
                  ? `Filter, ${activeFilterCount()} active`
                  : 'Filter'
              }
            >
              <FilterIcon />
              <Show when={activeFilterCount() > 0}>
                <span class="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold leading-4 text-panel">
                  {activeFilterCount()}
                </span>
              </Show>
            </Dropdown.Trigger>
          </Tooltip>
        }
      />
      <Show when={activeFilterCount() > 0}>
        <Button
          variant="ghost"
          size="icon-sm"
          class="text-ink-extra-muted hover:text-ink"
          label="Clear filters"
          aria-label="Clear filters"
          onClick={resetToTabDefaults}
        >
          <XIcon />
        </Button>
      </Show>
    </div>
  );

  const PrimaryControls = () => (
    <div class="ml-auto flex shrink-0 flex-nowrap items-center justify-end gap-2 [&_[data-button]]:h-8 [&_[data-button]]:min-w-8 [&_[data-button]]:rounded-lg @max-[720px]/experimental-soup:gap-1">
      <Show when={props.view !== 'inbox'}>
        <SoupViewContextSort hideLabel />
      </Show>
      <SoupViewContextGroup hideLabel />
      <ExperimentalFilterControl />
      <Show when={props.view === 'crm'}>
        <CompanyDisplayMenu />
        <CompanyViewsMenu />
      </Show>
      <Show when={props.view !== 'messages' && props.view !== 'machines'}>
        <PreviewButton
          hideLabel
          disabled={!props.hasPreviewItems}
          disabledLabel="No items to preview"
          onEngage={props.onPreviewEngage}
          onOpenChange={props.onPreviewOpenChange}
        />
      </Show>
    </div>
  );

  const SearchBar = () => (
    <div class="w-full min-w-20 max-w-md">
      <SoupSearchbar
        variant="filled"
        size="comfortable"
        class="rounded-2xl"
        placeholder={searchPlaceholder()}
        initialValue={props.initialSearchText}
      />
    </div>
  );

  const SearchAndControls = (
    controlProps: { flush?: boolean } = {}
  ) => (
    <div
      class={cn(
        'flex items-center gap-4 @max-[720px]/experimental-soup:gap-2',
        controlProps.flush ? 'mt-0' : 'mt-6'
      )}
    >
      <SearchBar />
      <PrimaryControls />
    </div>
  );

  const LibraryTypeQuickFilters = (
    quickFilterProps: { inline?: boolean } = {}
  ) => (
    <HorizontalScrollArea
      class={quickFilterProps.inline ? 'min-w-0 flex-1' : 'mt-3 pb-1'}
      ariaLabel="Quick type filters"
    >
      <For each={LIBRARY_TYPE_FILTERS}>
        {(filter) => {
          const active = () =>
            soupView.soup.predicates.isActive(filter.id);
          return (
            <button
              type="button"
              class={cn(
                'flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium text-ink-muted transition-colors',
                active()
                  ? 'border-transparent bg-active text-ink'
                  : 'border-edge bg-transparent hover:bg-hover hover:text-ink'
              )}
              aria-pressed={active()}
              onClick={() => toggleLibraryTypeFilter(filter.id)}
            >
              <Dynamic component={filter.icon} class="size-3.5" />
              {filter.label}
            </button>
          );
        }}
      </For>
    </HorizontalScrollArea>
  );

  const ViewSidebarControl = (menuProps: {
    children: JSX.Element;
    contentClass?: string;
  }) => (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        class={cn(
          '!size-8 shrink-0 rounded-full @max-[720px]/experimental-soup:hidden',
          !viewSidebarCollapsed() && 'bg-active text-ink'
        )}
        label={
          viewSidebarCollapsed()
            ? `Expand ${VIEW_TITLES[props.view]} navigation`
            : `Collapse ${VIEW_TITLES[props.view]} navigation`
        }
        aria-label={
          viewSidebarCollapsed()
            ? `Expand ${VIEW_TITLES[props.view]} navigation`
            : `Collapse ${VIEW_TITLES[props.view]} navigation`
        }
        aria-expanded={!viewSidebarCollapsed()}
        onClick={() => setViewSidebarCollapsed((collapsed) => !collapsed)}
      >
        <MenuIcon class="size-4" />
      </Button>
      <div class="hidden @max-[720px]/experimental-soup:block">
        <Dropdown
          open={viewMenuOpen()}
          onOpenChange={setViewMenuOpen}
          placement="bottom-start"
        >
          <Dropdown.Trigger
            variant="ghost"
            size="icon-sm"
            class="!size-8 shrink-0 rounded-full"
            label={`Open ${VIEW_TITLES[props.view]} navigation`}
            aria-label={`Open ${VIEW_TITLES[props.view]} navigation`}
          >
            <MenuIcon class="size-4" />
          </Dropdown.Trigger>
          <Dropdown.Content
            class={cn('w-72 rounded-2xl p-2', menuProps.contentClass)}
          >
            <div class="rounded-xl bg-menu">{menuProps.children}</div>
          </Dropdown.Content>
        </Dropdown>
      </div>
    </>
  );

  const BrainNavigation = () => (
    <div class="flex min-h-0 flex-1 flex-col">
      <ExperimentalViewSidebarItems class="shrink-0">
        <nav aria-label="Brain sections" class="flex flex-col gap-0.5">
          <For each={MACHINE_ITEMS.filter((item) => item.value !== 'agents')}>
            {(item) => {
              const active = () =>
                !selectedBrainChatId() && powersTab() === item.value;
              return (
                <button
                  type="button"
                  class={cn(
                    'flex w-full shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors',
                    active()
                      ? 'bg-active text-ink'
                      : 'text-ink-muted hover:bg-ink/5 hover:text-ink'
                  )}
                  aria-pressed={active()}
                  onClick={() => {
                    selectPowersTab(item.value);
                    setViewMenuOpen(false);
                  }}
                >
                  <Dynamic component={item.icon} class="size-4 shrink-0" />
                  {item.label}
                </button>
              );
            }}
          </For>
        </nav>
      </ExperimentalViewSidebarItems>

      <div class="my-4 shrink-0 border-t border-edge-muted" />

      <div class="flex min-h-0 flex-1 flex-col gap-3">
        <div class="flex shrink-0 items-center justify-between px-1">
          <span class="text-xs font-semibold uppercase tracking-wide text-ink-extra-muted">
            Chats
          </span>
        </div>
        <div class="flex shrink-0 items-center">
          <div class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-2xl bg-ink/4 px-3 text-ink-muted focus-within:ring-2 focus-within:ring-accent/30">
            <MagnifyingGlassIcon class="size-3.5 shrink-0" />
            <input
              type="search"
              value={brainChatSearch()}
              onInput={(event) =>
                setBrainChatSearch(event.currentTarget.value)
              }
              placeholder="Search chats"
              class="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder"
            />
          </div>
        </div>
        <Show
          when={visibleBrainChats().length > 0}
          fallback={
            <div class="flex flex-col items-center gap-3 px-3 py-6 text-center text-sm text-ink-extra-muted">
              <span>No chats found</span>
              <Button
                variant="cta"
                size="sm"
                class="h-8 rounded-full px-3"
                onClick={startBrainChat}
              >
                <NoteIcon class="size-3.5" />
                <span>Chat</span>
              </Button>
            </div>
          }
        >
          <div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            <For each={visibleBrainChats()}>
              {(chat) => (
                <ExperimentalChatHistoryItem
                  chat={chat}
                  active={selectedBrainChatId() === chat.id}
                  onOpen={() => {
                    selectBrainChat(chat.id);
                    setViewMenuOpen(false);
                  }}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );

  const InboxTabs = () => (
    <HorizontalScrollArea
      class="min-w-0 flex-1"
      contentClass="gap-1"
      ariaLabel="Inbox sections"
    >
      <For each={INBOX_ITEMS}>
        {(item) => {
          const active = () => soupView.activeTab() === item.value;
          return (
            <button
              type="button"
              class={cn(
                'flex h-10 items-center gap-2 rounded-full border px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40',
                active()
                  ? 'border-transparent bg-active text-ink'
                  : 'border-transparent text-ink-muted hover:bg-ink/5 hover:text-ink'
              )}
              aria-pressed={active()}
              onClick={() => selectTab(item.value)}
            >
              <Dynamic component={item.icon} class="size-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        }}
      </For>
    </HorizontalScrollArea>
  );

  const ListContentContainer = (containerProps: {
    children: JSX.Element;
  }) => (
    <main class="flex min-h-0 min-w-0 flex-1 flex-col">
      {containerProps.children}
    </main>
  );

  const Body = (_bodyProps: { adjacentToSidebar?: boolean } = {}) => (
    <section class="min-h-0 flex-1 px-4 pb-4 @max-[760px]/experimental-soup:px-3 @max-[480px]/experimental-soup:px-2">
      <div
        class={cn(
          'flex size-full min-h-0 flex-col overflow-hidden',
          props.view !== 'messages' &&
            props.view !== 'machines' &&
            'rounded-2xl bg-ink/2 p-2',
          props.view === 'tasks' &&
            '[&_[data-soup-section-header]]:bg-transparent!'
        )}
      >
        {props.children}
      </div>
    </section>
  );

  const MachineCollectionLayout = () => (
    <ListContentContainer>
      <header class="shrink-0 px-4 pb-5 pt-5 @max-[760px]/experimental-soup:px-3 @max-[480px]/experimental-soup:px-2">
        <div class="flex min-w-0 items-center gap-3">
          <h1 class="m-0 min-w-0 flex-1 truncate text-2xl font-medium tracking-[-0.03em] text-ink">
            {powersTab() === 'skills' ? 'Skills' : 'Routines'}
          </h1>
          <SoupViewCreateButton
            inline
            experimental
            preferredOptionId={
              powersTab() === 'skills' ? 'skill' : 'automation'
            }
          />
        </div>
        <div class="mt-4">
          <SearchAndControls flush />
        </div>
      </header>
      <Body />
    </ListContentContainer>
  );

  const MachineIntegrationsLayout = () => <ExperimentalIntegrationsView />;

  const MachineMemoriesLayout = () => <ExperimentalMemoriesView />;

  const automationSchedule = (
    entity: Extract<
      Extract<ExperimentalPowersDetail, { kind: 'entity' }>['entity'],
      { type: 'automation' }
    >
  ) => {
    const localTimezone = getDefaultTimezone();
    const timezone = entity.timezone;
    const description = describeSchedule(
      parseCron(entity.cron),
      timezone && timezone !== localTimezone ? timezone : undefined
    );
    return description.charAt(0).toUpperCase() + description.slice(1);
  };

  const PowersEntityDetails = (detailProps: {
    detail: Extract<ExperimentalPowersDetail, { kind: 'entity' }>;
  }) => (
    <div class="flex flex-col gap-5">
      <Show
        when={detailProps.detail.entity.type === 'automation'}
        fallback={
          <>
            <section>
              <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-extra-muted">
                About this skill
              </h3>
              <p class="text-sm leading-5 text-ink-muted">
                A reusable set of instructions Macro can apply while working
                with you.
              </p>
            </section>
            <section class="flex items-center justify-between gap-3 border-t border-edge pt-4">
              <span class="text-sm text-ink-muted">Updated</span>
              <span class="text-sm text-ink">
                <Entity.Timestamp entity={detailProps.detail.entity} />
              </span>
            </section>
          </>
        }
      >
        <section class="flex items-center justify-between gap-3">
          <span class="text-sm text-ink-muted">Status</span>
          <span
            class={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold',
              detailProps.detail.entity.type === 'automation' &&
                detailProps.detail.entity.isRunning
                ? 'bg-accent/10 text-accent'
                : detailProps.detail.entity.type === 'automation' &&
                    detailProps.detail.entity.enabled
                  ? 'bg-success/10 text-success'
                  : 'bg-ink/7 text-ink-muted'
            )}
          >
            <span
              class={cn(
                'size-1.5 rounded-full',
                detailProps.detail.entity.type === 'automation' &&
                  detailProps.detail.entity.isRunning
                  ? 'animate-pulse bg-accent'
                  : detailProps.detail.entity.type === 'automation' &&
                      detailProps.detail.entity.enabled
                    ? 'bg-success'
                    : 'bg-ink-extra-muted'
              )}
            />
            {detailProps.detail.entity.type === 'automation' &&
            detailProps.detail.entity.isRunning
              ? 'Running'
              : detailProps.detail.entity.type === 'automation' &&
                  detailProps.detail.entity.enabled
                ? 'Active'
                : 'Paused'}
          </span>
        </section>
        <Show
          when={
            detailProps.detail.entity.type === 'automation'
              ? detailProps.detail.entity.prompt
              : undefined
          }
        >
          {(prompt) => (
            <section>
              <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-extra-muted">
                Prompt
              </h3>
              <p class="whitespace-pre-wrap text-sm leading-5 text-ink-muted">
                {prompt()}
              </p>
            </section>
          )}
        </Show>
        <Show when={detailProps.detail.entity.type === 'automation'}>
          <section class="border-t border-edge pt-4">
            <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-extra-muted">
              Schedule
            </h3>
            <p class="text-sm leading-5 text-ink-muted">
              {automationSchedule(
                detailProps.detail.entity as Extract<
                  typeof detailProps.detail.entity,
                  { type: 'automation' }
                >
              )}
            </p>
          </section>
        </Show>
      </Show>
    </div>
  );

  const expandPowersEntity = () => {
    const detail = powersDetail();
    if (!detail || detail.kind !== 'entity') return;
    void openEntityInSplitFromUnifiedList(detail.entity, {
      openInNewSplit: true,
      allowDuplicate: true,
      splitHandle: panel.handle,
      referredFrom: 'sidebar',
    });
  };

  const PowersDetailsSidebar = () => {
    const currentTab = () =>
      MACHINE_ITEMS.find((item) => item.value === powersTab());
    const selectedTitle = () => {
      const detail = powersDetail();
      if (!detail) return currentTab()?.label;
      if (detail.kind === 'integration') return detail.integration.name;
      if (detail.kind === 'memory') return 'Your context';
      return detail.entity.name;
    };

    return (
      <>
        <Show when={powersDetail()}>
          <button
            type="button"
            class="absolute inset-0 z-modal-overlay hidden bg-modal-overlay @max-[860px]/experimental-soup:block"
            aria-label="Close Brain details"
            onClick={() => setPowersDetail(undefined)}
          />
        </Show>
        <aside
          data-layer
          data-depth={2}
          class={cn(
            'relative flex w-80 shrink-0 flex-col border-l border-edge',
            '@max-[860px]/experimental-soup:absolute @max-[860px]/experimental-soup:inset-y-0 @max-[860px]/experimental-soup:right-0 @max-[860px]/experimental-soup:z-modal-content @max-[860px]/experimental-soup:w-[min(24rem,100%)] @max-[860px]/experimental-soup:shadow-menu',
            !powersDetail() && '@max-[860px]/experimental-soup:hidden'
          )}
        >
          <header class="flex shrink-0 items-center justify-between gap-3 p-4">
            <div class="flex min-w-0 items-center gap-2.5">
              <Show
                when={powersDetail()}
                fallback={
                  <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-lift text-ink">
                    <Dynamic component={currentTab()?.icon} class="size-3.5" />
                  </div>
                }
              >
                {(detail) => (
                  <Switch>
                    <Match when={detail().kind === 'entity'}>
                      <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-lift [&_img]:size-4! [&_svg]:size-4!">
                        <Entity.Icon
                          entity={
                            (
                              detail() as Extract<
                                ExperimentalPowersDetail,
                                { kind: 'entity' }
                              >
                            ).entity
                          }
                        />
                      </div>
                    </Match>
                    <Match when={detail().kind === 'integration'}>
                      <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-lift text-ink [&_img]:size-5 [&_svg]:size-5">
                        <ExperimentalIntegrationIcon
                          integration={() =>
                            (
                              detail() as Extract<
                                ExperimentalPowersDetail,
                                { kind: 'integration' }
                              >
                            ).integration
                          }
                        />
                      </div>
                    </Match>
                    <Match when={detail().kind === 'memory'}>
                      <CoreBadge />
                    </Match>
                  </Switch>
                )}
              </Show>
              <h2 class="min-w-0 truncate text-sm font-semibold text-ink">
                {selectedTitle()}
              </h2>
            </div>
            <div class="flex shrink-0 items-center gap-0.5">
              <Show when={powersDetail()?.kind === 'entity'}>
                <Button
                  variant="ghost"
                  size="icon-md"
                  class="rounded-full [&_svg]:size-4!"
                  label="Open in split"
                  aria-label="Open in split"
                  onClick={expandPowersEntity}
                >
                  <ExpandIcon class="size-4" />
                </Button>
              </Show>
              <Show when={powersDetail()?.kind === 'memory'}>
                <Button
                  variant="ghost"
                  size="sm"
                  class="rounded-full bg-ink/8 px-3 text-ink hover:bg-ink/12"
                >
                  Edit
                </Button>
              </Show>
              <Show when={powersDetail()}>
                <Button
                  variant="ghost"
                  size="icon-md"
                  class="rounded-full [&_svg]:size-3.5!"
                  label="Close details"
                  aria-label="Close details"
                  onClick={() => setPowersDetail(undefined)}
                >
                  <XIcon class="size-4" />
                </Button>
              </Show>
            </div>
          </header>
          <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <Show
              when={powersDetail()}
              fallback={
                <div class="flex flex-col gap-6 py-2">
                  <div class="flex flex-col gap-2">
                    <For each={POWERS_TAB_DESCRIPTIONS[powersTab()]}>
                      {(paragraph) => (
                        <p class="text-sm leading-5 text-ink-muted">
                          {paragraph}
                        </p>
                      )}
                    </For>
                  </div>
                  <section>
                    <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-extra-muted">
                      Getting started
                    </h3>
                    <ol class="mt-3 flex flex-col gap-3">
                      <For each={POWERS_TAB_CHECKLISTS[powersTab()]}>
                        {(item) => (
                          <li>
                            <Checkbox
                              checked={false}
                              readOnly
                              class="pointer-events-none items-start text-sm leading-5 text-ink-muted"
                            >
                              <Checkbox.Control class="mt-0.5" />
                              <Checkbox.Label>{item}</Checkbox.Label>
                            </Checkbox>
                          </li>
                        )}
                      </For>
                    </ol>
                  </section>
                  <a
                    href={POWERS_TAB_DOCS_URLS[powersTab()]}
                    target="_blank"
                    rel="noreferrer"
                    class="inline-flex w-fit items-center gap-1.5 rounded-full bg-ink/8 px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-ink/12"
                  >
                    Read the docs
                    <ArrowSquareOutIcon class="size-3.5" />
                  </a>
                </div>
              }
            >
              {(detail) => (
                <Switch>
                  <Match when={detail().kind === 'entity'}>
                    <PowersEntityDetails
                      detail={
                        detail() as Extract<
                          ExperimentalPowersDetail,
                          { kind: 'entity' }
                        >
                      }
                    />
                  </Match>
                  <Match when={detail().kind === 'integration'}>
                    <ExperimentalIntegrationDetails
                      integration={
                        (
                          detail() as Extract<
                            ExperimentalPowersDetail,
                            { kind: 'integration' }
                          >
                        ).integration
                      }
                    />
                  </Match>
                  <Match when={detail().kind === 'memory'}>
                    <ExperimentalMemoryDetails />
                  </Match>
                </Switch>
              )}
            </Show>
          </div>
        </aside>
      </>
    );
  };

  const PowersLayout = () => (
    <ExperimentalPowersDetailsContext.Provider
      value={{
        detail: powersDetail,
        select: (detail) => setPowersDetail(detail),
        clear: () => setPowersDetail(undefined),
      }}
    >
      <div class="flex size-full min-h-0">
        <ExperimentalViewSidebar
          label="Brain navigation"
          class="mb-0 border-r-0! bg-ink/2 pt-2"
          collapsed={viewSidebarCollapsed()}
        >
          <ComposedSplitHeader class="flex min-h-8 shrink-0 items-center">
            <ComposedSplitControls />
          </ComposedSplitHeader>
          <div class="mt-3 flex shrink-0 items-center gap-2">
            <h1 class="m-0 min-w-0 flex-1 truncate text-2xl font-semibold tracking-[-0.03em] text-ink">
              Brain
            </h1>
            <Button
              variant="cta"
              size="sm"
              class="h-8 shrink-0 rounded-full px-2.5"
              onClick={startBrainChat}
            >
              <NoteIcon class="size-3.5" />
              <span>Chat</span>
            </Button>
          </div>
          <div class="mt-3 flex min-h-0 flex-1 flex-col">
            <BrainNavigation />
          </div>
        </ExperimentalViewSidebar>

        <ListContentContainer>
          <div class="hidden shrink-0 px-2 pt-2 @max-[720px]/experimental-soup:block">
            <div class="flex min-h-7 items-center">
              <ComposedSplitControls />
            </div>
            <div class="mt-1 flex min-w-0 items-center gap-2">
              <ViewSidebarControl>
                <BrainNavigation />
              </ViewSidebarControl>
              <h1 class="m-0 min-w-0 flex-1 truncate text-2xl font-semibold tracking-[-0.03em] text-ink">
                Brain
              </h1>
              <Button
                variant="cta"
                size="sm"
                class="h-8 shrink-0 rounded-full px-2.5"
                onClick={startBrainChat}
              >
                <NoteIcon class="size-3.5" />
                <span>Chat</span>
              </Button>
            </div>
          </div>
          <div class="relative flex min-h-0 flex-1">
            <div class="flex min-h-0 min-w-0 flex-1">
              <Show
                when={selectedBrainChatBlock()}
                fallback={
                  <Switch fallback={<MachineCollectionLayout />}>
                    <Match when={powersTab() === 'agents'}>
                      <ChatWorkspaceMain
                        activeChatBlock={undefined}
                        onChatCreated={selectBrainChat}
                      />
                    </Match>
                    <Match when={powersTab() === 'integrations'}>
                      <MachineIntegrationsLayout />
                    </Match>
                    <Match when={powersTab() === 'memories'}>
                      <MachineMemoriesLayout />
                    </Match>
                  </Switch>
                }
              >
                {(block) => (
                  <SidePanel.Layout defaultOpen={false} narrowThreshold={640}>
                    <div class="flex size-full min-h-0 flex-col overflow-hidden">
                      <header class="flex h-10 shrink-0 items-center justify-end px-2">
                        <SidePanel.Toggle class="rounded-full" />
                      </header>
                      <div class="min-h-0 flex-1 overflow-hidden">
                        <Dynamic component={block().element} />
                      </div>
                    </div>
                  </SidePanel.Layout>
                )}
              </Show>
            </div>
            <Show when={!selectedBrainChatId()}>
              <PowersDetailsSidebar />
            </Show>
          </div>
        </ListContentContainer>
      </div>
    </ExperimentalPowersDetailsContext.Provider>
  );

  const EmailNavigation = () => (
    <>
      <div>
        <InboxSelector inline experimentalSidebar />
      </div>
      <ExperimentalViewSidebarItems
        class="mt-3"
      >
        <nav aria-label="Email views" class="flex flex-col gap-0.5">
        <For each={emailTabs()}>
          {(tab) => {
            const active = () => soupView.activeTab() === tab.value;
            return (
              <button
                type="button"
                class={cn(
                  'flex w-full shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors',
                  active()
                    ? 'bg-active text-ink'
                    : 'text-ink-muted hover:bg-ink/5 hover:text-ink'
                )}
                aria-pressed={active()}
                onClick={() => {
                  selectTab(tab.value);
                  setViewMenuOpen(false);
                }}
              >
                <Dynamic
                  component={EMAIL_TAB_ICONS[tab.value]}
                  class="size-4 shrink-0"
                />
                {tab.label}
              </button>
            );
          }}
        </For>
        </nav>
      </ExperimentalViewSidebarItems>
    </>
  );

  const LibraryNavigation = () => (
    <ExperimentalViewSidebarItems class="mt-0">
      <nav aria-label="Drive views" class="flex flex-col gap-0.5">
        <For each={LIBRARY_ITEMS}>
          {(item) => {
            const active = () => librarySection() === item.value;
            return (
              <button
                type="button"
                class={cn(
                  'flex w-full shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors',
                  active()
                    ? 'bg-active text-ink'
                    : 'text-ink-muted hover:bg-ink/5 hover:text-ink'
                )}
                aria-pressed={active()}
                onClick={() => {
                  selectLibrarySection(item.value);
                  setViewMenuOpen(false);
                }}
              >
                <Dynamic component={item.icon} class="size-4" />
                {item.label}
              </button>
            );
          }}
        </For>

        <ExperimentalDriveTreeSection
          active={librarySection() === 'my-drive'}
          activeProjectId={selectedLibraryProjectId()}
          onSelectRoot={() => selectLibrarySection('my-drive')}
          onSelect={(project) => selectLibraryProject(project.id)}
        />

        <ExperimentalDriveFavoritesSection
          active={librarySection() === 'favorites'}
          onSelectRoot={selectLibraryFavorites}
          onOpen={() => setViewMenuOpen(false)}
        />
      </nav>

      <Show when={soupView.tagFilter.hasTags()}>
        <section class="mt-5">
          <h2 class="px-1 text-xs font-semibold uppercase tracking-wide text-ink-extra-muted">
            Tags
          </h2>
          <div class="mt-2 flex flex-wrap items-start gap-1.5">
            <For
              each={soupView.tagFilter
                .tagSets()
                .flatMap((tagSet) => tagSet.options)}
            >
              {(tag) => {
                const active = () =>
                  soupView.tagFilter.activeIds().includes(tag.id);
                const color = () => tag.color ?? '#889096';
                const label = () =>
                  tag.value.type === 'string' ? tag.value.value : tag.id;
                return (
                  <button
                    type="button"
                    class={cn(
                      'experimental-v2-drive-tag inline-flex min-w-0 max-w-full items-center rounded-full px-2 py-1 text-xs transition-[filter,background-color,color]',
                      active()
                        ? 'font-semibold saturate-125'
                        : 'saturate-100 hover:saturate-125'
                    )}
                    style={{ '--drive-tag-color': color() }}
                    data-active={active() || undefined}
                    aria-pressed={active()}
                    onClick={() => {
                      const activeIds = soupView.tagFilter.activeIds();
                      soupView.tagFilter.onChange(
                        active()
                          ? activeIds.filter((id) => id !== tag.id)
                          : [...activeIds, tag.id]
                      );
                    }}
                  >
                    <span class="truncate">{label()}</span>
                    <Show when={active()}>
                      <CheckIcon class="ml-1 size-3 shrink-0" />
                    </Show>
                  </button>
                );
              }}
            </For>
          </div>
        </section>
      </Show>
    </ExperimentalViewSidebarItems>
  );

  const TaskNavigation = () => (
    <ExperimentalViewSidebarItems class="mt-0">
      <nav aria-label="Task views" class="flex flex-col gap-0.5">
        <For each={TASK_PERSONAL_ITEMS}>
          {(item) => {
            const active = () => soupView.activeTab() === item.value;
            return (
              <button
                type="button"
                class={cn(
                  'flex w-full shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors',
                  active()
                    ? 'bg-active text-ink'
                    : 'text-ink-muted hover:bg-ink/5 hover:text-ink'
                )}
                aria-pressed={active()}
                onClick={() => {
                  selectTab(item.value);
                  setViewMenuOpen(false);
                }}
              >
                <Dynamic component={item.icon} class="size-4 shrink-0" />
                {item.label}
              </button>
            );
          }}
        </For>

        <button
          type="button"
          class={cn(
            'mt-3 flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink',
            TASK_TEAM_ITEMS.some(
              (item) => item.value === soupView.activeTab()
            ) && 'text-ink'
          )}
          aria-expanded={taskTeamExpanded()}
          onClick={() => setTaskTeamExpanded((expanded) => !expanded)}
        >
          <UsersIcon class="size-4 shrink-0" />
          <span class="min-w-0 flex-1 truncate">{taskTeamName()}</span>
          <CaretRightIcon
            class={cn(
              'size-3 shrink-0 transition-transform',
              taskTeamExpanded() && 'rotate-90'
            )}
          />
        </button>
        <Show when={taskTeamExpanded()}>
          <For each={TASK_TEAM_ITEMS}>
          {(item) => {
            const active = () => soupView.activeTab() === item.value;
            return (
              <button
                type="button"
                class={cn(
                  'flex w-full shrink-0 items-center gap-2.5 rounded-xl py-2 pl-8 pr-3 text-left text-sm font-medium transition-colors',
                  active()
                    ? 'bg-active text-ink'
                    : 'text-ink-muted hover:bg-ink/5 hover:text-ink'
                )}
                aria-pressed={active()}
                onClick={() => {
                  selectTab(item.value);
                  setViewMenuOpen(false);
                }}
              >
                <Dynamic component={item.icon} class="size-4 shrink-0" />
                {item.label}
              </button>
            );
          }}
          </For>
        </Show>
      </nav>
    </ExperimentalViewSidebarItems>
  );

  const NarrowViewHeader = (headerProps: {
    title: string;
    navigation: JSX.Element;
    dropdownContentClass?: string;
  }) => (
    <div class="hidden shrink-0 px-2 pt-2 @max-[720px]/experimental-soup:block">
      <div class="flex min-h-7 items-center">
        <ComposedSplitControls />
      </div>
      <div class="mt-1 flex min-w-0 items-center gap-2">
        <ViewSidebarControl contentClass={headerProps.dropdownContentClass}>
          {headerProps.navigation}
        </ViewSidebarControl>
        <h1 class="m-0 min-w-0 flex-1 truncate text-2xl font-semibold tracking-[-0.03em] text-ink">
          {headerProps.title}
        </h1>
        <SoupViewCreateButton inline experimental />
      </div>
    </div>
  );

  const InboxLayout = () => (
    <div class="flex size-full min-h-0 flex-col">
      <ComposedSplitHeader class="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-4 pb-4 pt-2 @max-[720px]/experimental-soup:px-2">
        <ComposedSplitControls />
        <div class="flex min-w-0 flex-1 items-center gap-6 @max-[720px]/experimental-soup:gap-3">
          <h1 class="m-0 shrink-0 truncate text-2xl font-semibold tracking-[-0.03em] text-ink">
            Inbox
          </h1>
          <InboxTabs />
        </div>
        <SoupViewCreateButton inline experimental />
      </ComposedSplitHeader>
      <ListContentContainer>
        <header class="shrink-0 px-4 pb-5 pt-4 @max-[760px]/experimental-soup:px-3 @max-[480px]/experimental-soup:px-2">
          <SearchAndControls flush />
        </header>
        <Body />
      </ListContentContainer>
    </div>
  );

  const EmailLayout = () => (
    <div class="flex size-full min-h-0">
      <ExperimentalViewSidebar
        label="Email navigation"
        class="mb-0 border-r-0! pt-2"
        collapsed={viewSidebarCollapsed()}
      >
        <ComposedSplitHeader class="flex min-h-8 shrink-0 items-center">
          <ComposedSplitControls />
        </ComposedSplitHeader>
        <div class="mt-3 flex shrink-0 items-center gap-2">
          <h1 class="m-0 min-w-0 flex-1 truncate text-2xl font-semibold tracking-[-0.03em] text-ink">
            Email
          </h1>
          <SoupViewCreateButton inline experimental />
        </div>
        <div class="mt-5 min-h-0 flex-1 overflow-y-auto">
          <EmailNavigation />
        </div>
      </ExperimentalViewSidebar>

      <ListContentContainer>
        <NarrowViewHeader
          title="Email"
          navigation={<EmailNavigation />}
        />
        <header class="shrink-0 px-4 pb-5 pt-4 @max-[760px]/experimental-soup:px-3 @max-[480px]/experimental-soup:px-2">
          <div class="flex min-w-0 items-center gap-4 @max-[720px]/experimental-soup:gap-2">
            <div class="min-w-0 flex-1">
              <SearchBar />
            </div>
          </div>
          <div class="mt-3 flex min-w-0 items-center justify-end">
            <PrimaryControls />
          </div>
        </header>
        <Body adjacentToSidebar />
      </ListContentContainer>
    </div>
  );

  const LibraryLayout = () => (
    <div class="flex size-full min-h-0">
      <ExperimentalViewSidebar
        label="Drive navigation"
        class="mb-0 border-r-0! pt-2"
        collapsed={viewSidebarCollapsed()}
      >
        <ComposedSplitHeader class="flex min-h-8 shrink-0 items-center">
          <ComposedSplitControls />
        </ComposedSplitHeader>
        <div class="mt-3 flex shrink-0 items-center gap-2">
          <h1 class="m-0 min-w-0 flex-1 truncate text-2xl font-semibold tracking-[-0.03em] text-ink">
            Drive
          </h1>
          <SoupViewCreateButton inline experimental />
        </div>
        <div class="mt-5 min-h-0 flex-1 overflow-y-auto">
          <LibraryNavigation />
        </div>
      </ExperimentalViewSidebar>

      <ListContentContainer>
        <NarrowViewHeader
          title="Drive"
          navigation={<LibraryNavigation />}
        />
        <header class="shrink-0 px-4 pb-5 pt-4 @max-[760px]/experimental-soup:px-3 @max-[480px]/experimental-soup:px-2">
          <div class="flex min-w-0 items-center gap-4 @max-[720px]/experimental-soup:gap-2">
            <div class="min-w-0 flex-1">
              <SearchBar />
            </div>
          </div>
          <div class="mt-3 flex min-w-0 items-center gap-4 @max-[720px]/experimental-soup:gap-2">
            <div class="min-w-0 flex-1">
              <LibraryTypeQuickFilters inline />
            </div>
            <PrimaryControls />
          </div>
        </header>
        <Body adjacentToSidebar />
      </ListContentContainer>
    </div>
  );

  const TasksLayout = () => (
    <div class="flex size-full min-h-0">
      <ExperimentalViewSidebar
        label="Task navigation"
        class="mb-0 border-r-0! pt-2"
        collapsed={viewSidebarCollapsed()}
      >
        <ComposedSplitHeader class="flex min-h-8 shrink-0 items-center">
          <ComposedSplitControls />
        </ComposedSplitHeader>
        <div class="mt-3 flex shrink-0 items-center gap-2">
          <h1 class="m-0 min-w-0 flex-1 truncate text-2xl font-semibold tracking-[-0.03em] text-ink">
            Tasks
          </h1>
          <SoupViewCreateButton inline experimental />
        </div>
        <div class="mt-5 min-h-0 flex-1 overflow-y-auto">
          <TaskNavigation />
        </div>
      </ExperimentalViewSidebar>

      <ListContentContainer>
        <NarrowViewHeader
          title="Tasks"
          navigation={<TaskNavigation />}
        />
        <header class="shrink-0 px-4 pb-5 pt-4 @max-[760px]/experimental-soup:px-3 @max-[480px]/experimental-soup:px-2">
          <div class="flex min-w-0 items-center gap-4 @max-[720px]/experimental-soup:gap-2">
            <div class="min-w-0 flex-1">
              <SearchBar />
            </div>
          </div>
          <div class="mt-3 flex min-w-0 items-center justify-end">
            <PrimaryControls />
          </div>
        </header>
        <Body adjacentToSidebar />
      </ListContentContainer>
    </div>
  );

  const CrmLayout = () => (
    <div class="flex size-full min-h-0 flex-col">
      <ComposedSplitHeader class="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-4 pb-4 pt-2 @max-[720px]/experimental-soup:px-2">
        <ComposedSplitControls />
        <h1 class="m-0 min-w-0 flex-1 truncate text-2xl font-semibold tracking-[-0.03em] text-ink">
          CRM
        </h1>
        <SoupViewCreateButton inline experimental />
      </ComposedSplitHeader>
      <ListContentContainer>
        <header class="shrink-0 px-4 pb-5 pt-4 @max-[760px]/experimental-soup:px-3 @max-[480px]/experimental-soup:px-2">
          <SearchAndControls flush />
        </header>
        <Body />
      </ListContentContainer>
    </div>
  );

  const MessagesLayout = () => (
    <div class="flex size-full min-h-0">
      <ExperimentalMessagesRail
        selectedChannelId={selectedMessageChannelId()}
        onSelect={(channel) => selectMessageChannel(channel.id)}
      />
      <div class="min-h-0 min-w-0 flex-1 overflow-hidden pt-9">
        <Show
          when={selectedMessageChannelBlock()}
          fallback={
            <div class="flex size-full items-center justify-center px-6 text-center">
              <div class="max-w-sm">
                <h2 class="text-base font-semibold text-ink">
                  Select a conversation
                </h2>
                <p class="mt-2 text-sm leading-5 text-ink-muted">
                  Choose a channel or person from the sidebar to open the
                  conversation here.
                </p>
              </div>
            </div>
          }
        >
          {(block) => (
            <div class="size-full min-h-0">
              <Dynamic component={block().element} />
            </div>
          )}
        </Show>
      </div>
    </div>
  );

  return (
    <div class="@container/experimental-soup flex size-full min-h-0 flex-col bg-panel">
      <Switch fallback={<Body />}>
        <Match when={props.view === 'inbox'}>
          <InboxLayout />
        </Match>
        <Match when={props.view === 'email'}>
          <EmailLayout />
        </Match>
        <Match when={props.view === 'library'}>
          <LibraryLayout />
        </Match>
        <Match when={props.view === 'machines'}>
          <PowersLayout />
        </Match>
        <Match when={props.view === 'tasks'}>
          <TasksLayout />
        </Match>
        <Match when={props.view === 'messages'}>
          <MessagesLayout />
        </Match>
        <Match when={props.view === 'crm'}>
          <CrmLayout />
        </Match>
      </Switch>
    </div>
  );
}

/** Resolve the conceptual experimental view for a SoupView content id. */
export function experimentalSoupViewForContent(args: {
  contentId: string;
  requestedView?: ExperimentalSoupView;
}): ExperimentalSoupView | undefined {
  if (args.requestedView) return args.requestedView;
  const mapping: Partial<Record<ListView, ExperimentalSoupView>> = {
    inbox: 'inbox',
    mail: 'email',
    documents: 'library',
    agents: 'machines',
    tasks: 'tasks',
    channels: 'messages',
    companies: 'crm',
  };
  return mapping[args.contentId as ListView];
}
