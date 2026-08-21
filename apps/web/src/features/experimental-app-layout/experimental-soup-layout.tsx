import type { ListView } from '@app/constants/list-views';
import {
  describeSchedule,
  getDefaultTimezone,
  parseCron,
} from '@app/features/block-automation/component/automationUtils';
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
import { PreviewButton } from '@components/app/split-layout/components/PreviewButton';
import { Entity } from '@entity';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { ENABLE_CRM } from '@core/constant/featureFlags';
import { DOCS_BASE, LIST_VIEW_DOCS_URL } from '@app/constants/docs-links';
import { TOKENS } from '@core/hotkey/tokens';
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
import BuildingsIcon from '@phosphor/buildings.svg';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import ChatIcon from '@phosphor/chat-circle.svg';
import ClockIcon from '@phosphor/clock-counter-clockwise.svg';
import ClipboardIcon from '@phosphor/clipboard-text.svg';
import EnvelopeOpenIcon from '@phosphor/envelope-open.svg';
import FilterIcon from '@phosphor/funnel-simple.svg';
import FolderIcon from '@phosphor/folder-simple.svg';
import MenuIcon from '@phosphor/list.svg';
import NoteIcon from '@phosphor/note-pencil.svg';
import PaperPlaneIcon from '@phosphor/paper-plane-tilt.svg';
import PaperclipIcon from '@phosphor/paperclip.svg';
import PencilIcon from '@phosphor/pencil-line.svg';
import PlugIcon from '@phosphor/plug.svg';
import SquaresIcon from '@phosphor/squares-four.svg';
import ShareIcon from '@phosphor/share-network.svg';
import UserFocusIcon from '@phosphor/user-focus.svg';
import UsersIcon from '@phosphor/users-three.svg';
import { useCurrentTeamQuery } from '@queries/team/teams';
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
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
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
import {
  ExperimentalPowersDetailsContext,
  type ExperimentalPowersDetail,
} from './experimental-powers-details-context';
import {
  ExperimentalViewSidebar,
  ExperimentalViewSidebarItems,
} from './experimental-view-sidebar';

export type ExperimentalSoupView =
  | 'email'
  | 'library'
  | 'machines'
  | 'tasks'
  | 'people';

const VIEW_TITLES: Record<ExperimentalSoupView, string> = {
  email: 'Email',
  library: 'Library',
  machines: 'Powers',
  tasks: 'Tasks',
  people: 'People',
};

type ViewNavigationItem = {
  value: string;
  label: string;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
};

const TASK_PERSONAL_ITEMS: readonly ViewNavigationItem[] = [
  { value: 'my-tasks', label: 'My tasks', icon: UserFocusIcon },
  { value: 'created-by-me', label: 'Created by me', icon: PencilIcon },
  { value: 'shared-with-me', label: 'Shared with me', icon: ShareIcon },
];

const TASK_TEAM_ITEMS: readonly ViewNavigationItem[] = [
  { value: 'projects', label: 'Projects', icon: FolderIcon },
  { value: 'team-tasks', label: 'Team tasks', icon: ClipboardIcon },
];

type PowersTab = 'automations' | 'skills' | 'integrations' | 'memories';

const MACHINE_ITEMS: readonly (ViewNavigationItem & { value: PowersTab })[] = [
  { value: 'automations', label: 'Automations', icon: WideAutomationIcon },
  { value: 'skills', label: 'Skills', icon: SkillIcon },
  { value: 'integrations', label: 'Integrations', icon: PlugIcon },
  { value: 'memories', label: 'Memories', icon: BrainIcon },
];

const POWERS_TAB_DESCRIPTIONS: Record<PowersTab, readonly string[]> = {
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
  calendar: CalendarIcon,
  drafts: NoteIcon,
  shared: ShareIcon,
  all: EnvelopeOpenIcon,
};

type LibrarySection =
  | 'recents'
  | 'shared'
  | 'images'
  | 'attachments'
  | 'folders'
  | 'all';

const LIBRARY_ITEMS: readonly (ViewNavigationItem & {
  value: LibrarySection;
})[] = [
  { value: 'recents', label: 'Recents', icon: ClockIcon },
  { value: 'shared', label: 'Shared with me', icon: ShareIcon },
  { value: 'attachments', label: 'Email attachments', icon: PaperclipIcon },
  { value: 'folders', label: 'Folders', icon: FolderIcon },
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
  Record<ExperimentalSoupView, 'mail' | 'agents' | 'tasks'>
> = {
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
  const soupView = useSoupView();
  const { applyTabPreset } = useApplyPreset();
  const [powersTab, setPowersTab] = createSignal<PowersTab>(
    soupView.activeTab() === 'skills' ? 'skills' : 'automations'
  );
  const [powersDetail, setPowersDetail] =
    createSignal<ExperimentalPowersDetail>();
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

  const contentId = createMemo(() => {
    const content = panel.handle.content();
    return content.type === 'component' ? content.id : undefined;
  });

  const searchPlaceholder = createMemo(() => {
    if (props.view === 'email') return 'Search email';
    if (props.view === 'library') return 'Search library';
    if (props.view === 'tasks') return 'Search tasks';
    if (props.view === 'people') {
      return contentId() === 'companies'
        ? 'Search companies'
        : 'Search conversations';
    }
    if (props.view === 'machines') {
      return powersTab() === 'skills'
        ? 'Search skills'
        : 'Search automations';
    }
    return 'Search';
  });

  const tabView = () => TAB_VIEW_BY_EXPERIMENTAL_VIEW[props.view];
  const emailTabs = () => VIEW_TAB_LISTS.mail;

  const selectTab = (value: string) => {
    const view = tabView();
    if (view) applyTabPreset(view, value);
  };

  const selectPowersTab = (value: PowersTab) => {
    setPowersDetail(undefined);
    setPowersTab(value);
    if (value === 'automations' || value === 'skills') {
      applyTabPreset('agents', value);
    }
  };

  const initialLibrarySection = (): LibrarySection => {
    if (soupView.soup.predicates.isActive('file-image')) return 'images';
    const active = soupView.activeTab();
    if (
      active === 'all' &&
      soupView.soup.sort.active()[0]?.id === 'viewed_at'
    ) {
      return 'recents';
    }
    if (
      active === 'shared' ||
      active === 'attachments' ||
      active === 'folders' ||
      active === 'all'
    ) {
      return active;
    }
    return 'recents';
  };
  const [librarySection, setLibrarySection] =
    createSignal<LibrarySection>(initialLibrarySection());

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

  const selectLibrarySection = (section: LibrarySection) => {
    if (section === 'recents') {
      applyTabPreset('documents', 'all');
      clearLibraryImageFilter();
      soupView.soup.sort.setAll(['viewed_at']);
      setLibrarySection('recents');
      return;
    }

    if (section === 'images') {
      applyTabPreset('documents', 'all');
      setLibraryTypeFilters(['file-image']);
      setLibrarySection('images');
      return;
    }

    applyTabPreset('documents', section);
    clearLibraryImageFilter();
    setLibrarySection(section);
  };

  onMount(() => {
    if (props.view === 'library' && soupView.activeTab() === 'owned') {
      selectLibrarySection('recents');
      return;
    }
    if (
      props.view === 'machines' &&
      soupView.activeTab() !== 'automations' &&
      soupView.activeTab() !== 'skills'
    ) {
      applyTabPreset('agents', 'automations');
      return;
    }
    if (props.view === 'people' && contentId() === 'channels') {
      applyTabPreset('channels', 'experimental-conversations');
    }
  });

  createEffect(() => {
    if (
      props.view === 'library' &&
      librarySection() === 'images' &&
      !soupView.soup.predicates.isActive('file-image')
    ) {
      setLibrarySection('all');
    }
  });

  const openPeopleMode = (mode: 'conversations' | 'companies') => {
    if (mode === 'companies') {
      if (!ENABLE_CRM() || contentId() === 'companies') return;
      panel.handle.resetPreview();
      panel.handle.replace({
        next: { type: 'component', id: 'companies' },
        referredFrom: 'sidebar',
      });
      return;
    }

    if (contentId() === 'channels') {
      applyTabPreset('channels', 'experimental-conversations');
      return;
    }
    panel.handle.resetPreview();
    panel.handle.replace({
      next: {
        type: 'component',
        id: 'channels',
        params: {
          experimentalView: 'people',
          initialTab: 'experimental-conversations',
        },
      },
      referredFrom: 'sidebar',
    });
  };

  const isPeopleConversations = () => contentId() === 'channels';
  const isPeopleCompanies = () => contentId() === 'companies';

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
      <SoupViewContextSort hideLabel />
      <SoupViewContextGroup hideLabel />
      <ExperimentalFilterControl />
      <Show when={isPeopleCompanies()}>
        <CompanyDisplayMenu />
        <CompanyViewsMenu />
      </Show>
      <Show when={props.view !== 'people' && props.view !== 'machines'}>
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
        class="rounded-full"
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

  const ResponsiveListControls = (controlProps: {
    quickFilters?: boolean;
  }) => (
    <header class="shrink-0 px-6 pb-5 pt-4 @max-[760px]/experimental-soup:px-3 @max-[480px]/experimental-soup:px-2">
      <div class="flex min-w-0 items-center gap-4 @max-[720px]/experimental-soup:gap-2">
        <div class="hidden min-w-20 flex-1 @max-[720px]/experimental-soup:flex">
          <SearchBar />
        </div>
        <Show when={controlProps.quickFilters}>
          <div class="flex min-w-0 flex-1 @max-[720px]/experimental-soup:hidden">
            <LibraryTypeQuickFilters inline />
          </div>
        </Show>
        <PrimaryControls />
      </div>
      <Show when={controlProps.quickFilters}>
        <div class="hidden @max-[720px]/experimental-soup:block">
          <LibraryTypeQuickFilters />
        </div>
      </Show>
    </header>
  );

  const ViewSidebarControl = (menuProps: { children: JSX.Element }) => (
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
          <Dropdown.Content class="w-72 rounded-2xl p-2">
            {menuProps.children}
          </Dropdown.Content>
        </Dropdown>
      </div>
    </>
  );

  const MachineTabs = () => (
    <HorizontalScrollArea
      class="min-w-0 flex-1"
      contentClass="gap-1"
      ariaLabel="Powers sections"
    >
      <For each={MACHINE_ITEMS}>
        {(item) => {
          const active = () => powersTab() === item.value;
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
              onClick={() => selectPowersTab(item.value)}
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
    <section class="min-h-0 flex-1 px-6 @max-[760px]/experimental-soup:px-3 @max-[480px]/experimental-soup:px-2">
      <div class="flex size-full min-h-0 flex-col overflow-hidden">
        {props.children}
      </div>
    </section>
  );

  const MachineCollectionLayout = () => (
    <ListContentContainer>
      <header class="shrink-0 px-6 pb-5 pt-5 @max-[760px]/experimental-soup:px-3 @max-[480px]/experimental-soup:px-2">
        <SearchAndControls flush />
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
            aria-label="Close Powers details"
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
              <Show
                when={
                  !powersDetail() &&
                  (powersTab() === 'automations' || powersTab() === 'skills')
                }
              >
                <SoupViewCreateButton
                  inline
                  experimental
                  preferredOptionId={
                    powersTab() === 'skills' ? 'skill' : 'automation'
                  }
                />
              </Show>
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
      <div class="flex size-full min-h-0 flex-col">
        <header class="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-4 pb-4 pt-2 @max-[720px]/experimental-soup:px-2">
          <MachineTabs />
          <Show
            when={powersTab() === 'automations' || powersTab() === 'skills'}
          >
            <div class="hidden @max-[860px]/experimental-soup:block">
              <SoupViewCreateButton
                inline
                experimental
                preferredOptionId={
                  powersTab() === 'skills' ? 'skill' : 'automation'
                }
              />
            </div>
          </Show>
        </header>
        <div class="relative flex min-h-0 flex-1">
          <div class="flex min-h-0 min-w-0 flex-1">
            <Switch fallback={<MachineCollectionLayout />}>
              <Match when={powersTab() === 'integrations'}>
                <MachineIntegrationsLayout />
              </Match>
              <Match when={powersTab() === 'memories'}>
                <MachineMemoriesLayout />
              </Match>
            </Switch>
          </div>
          <PowersDetailsSidebar />
        </div>
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
        <nav aria-label="Email views" class="flex flex-col gap-1">
        <For each={emailTabs()}>
          {(tab) => {
            const active = () => soupView.activeTab() === tab.value;
            return (
              <button
                type="button"
                class={cn(
                  'flex w-full shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors',
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
      <nav aria-label="Library views" class="flex flex-col gap-1">
      <For each={LIBRARY_ITEMS}>
        {(item) => {
          const active = () => librarySection() === item.value;
          return (
            <button
              type="button"
              class={cn(
                'flex w-full shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors',
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
      </nav>
    </ExperimentalViewSidebarItems>
  );

  const TaskNavigation = () => (
    <ExperimentalViewSidebarItems class="mt-0">
      <nav aria-label="Task views" class="flex flex-col gap-1">
        <For each={TASK_PERSONAL_ITEMS}>
          {(item) => {
            const active = () => soupView.activeTab() === item.value;
            return (
              <button
                type="button"
                class={cn(
                  'flex w-full shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors',
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
            'mt-3 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink',
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
                  'flex w-full shrink-0 items-center gap-2.5 rounded-lg py-2.5 pl-8 pr-3 text-left text-sm font-medium transition-colors',
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

  const PeopleNavigation = () => (
    <>
      <ExperimentalViewSidebarItems class="mt-0">
        <nav aria-label="People views" class="flex flex-col gap-1">
        <button
          type="button"
          class={cn(
            'flex w-full shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors',
            isPeopleConversations()
              ? 'bg-active text-ink'
              : 'text-ink-muted hover:bg-ink/5 hover:text-ink'
          )}
          aria-pressed={isPeopleConversations()}
          onClick={() => {
            openPeopleMode('conversations');
            setViewMenuOpen(false);
          }}
        >
          <ChatIcon class="size-4 shrink-0" />
          Conversations
        </button>
        <Show when={ENABLE_CRM()}>
          <button
            type="button"
            class={cn(
              'flex w-full shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors',
              isPeopleCompanies()
                ? 'bg-active text-ink'
                : 'text-ink-muted hover:bg-ink/5 hover:text-ink'
            )}
            aria-pressed={isPeopleCompanies()}
            onClick={() => {
              openPeopleMode('companies');
              setViewMenuOpen(false);
            }}
          >
            <BuildingsIcon class="size-4 shrink-0" />
            Companies
          </button>
        </Show>
        </nav>
      </ExperimentalViewSidebarItems>
    </>
  );

  const ViewTitleRow = (titleProps: {
    title: string;
    navigation: JSX.Element;
  }) => (
    <header class="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-4 pb-4 pt-2 @max-[720px]/experimental-soup:px-2">
      <div class="flex min-w-0 flex-1 items-center gap-6 @max-[720px]/experimental-soup:gap-3">
        <div class="flex min-w-0 shrink-0 items-center gap-2 overflow-hidden">
          <ViewSidebarControl>{titleProps.navigation}</ViewSidebarControl>
          <h1 class="m-0 min-w-0 truncate text-2xl font-semibold tracking-[-0.03em] text-ink">
            {titleProps.title}
          </h1>
        </div>
        <div class="min-w-20 flex-1 @max-[720px]/experimental-soup:hidden">
          <SearchBar />
        </div>
      </div>
      <SoupViewCreateButton inline experimental />
    </header>
  );

  const EmailLayout = () => (
    <div class="flex size-full min-h-0 flex-col">
      <ViewTitleRow title="Email" navigation={<EmailNavigation />} />
      <div class="relative flex min-h-0 flex-1">
        <ExperimentalViewSidebar
          label="Email navigation"
          collapsed={viewSidebarCollapsed()}
        >
          <EmailNavigation />
        </ExperimentalViewSidebar>
        <ListContentContainer>
          <ResponsiveListControls />
          <Body adjacentToSidebar />
        </ListContentContainer>
      </div>
    </div>
  );

  const LibraryLayout = () => (
    <div class="flex size-full min-h-0 flex-col">
      <ViewTitleRow title="Library" navigation={<LibraryNavigation />} />
      <div class="relative flex min-h-0 flex-1">
        <ExperimentalViewSidebar
          label="Library navigation"
          collapsed={viewSidebarCollapsed()}
        >
          <LibraryNavigation />
        </ExperimentalViewSidebar>
        <ListContentContainer>
          <ResponsiveListControls quickFilters />
          <Body adjacentToSidebar />
        </ListContentContainer>
      </div>
    </div>
  );

  const TasksLayout = () => (
    <div class="flex size-full min-h-0 flex-col">
      <ViewTitleRow title="Tasks" navigation={<TaskNavigation />} />
      <div class="relative flex min-h-0 flex-1">
        <ExperimentalViewSidebar
          label="Task navigation"
          collapsed={viewSidebarCollapsed()}
        >
          <TaskNavigation />
        </ExperimentalViewSidebar>
        <ListContentContainer>
          <ResponsiveListControls />
          <Body adjacentToSidebar />
        </ListContentContainer>
      </div>
    </div>
  );

  const PeopleLayout = () => (
    <div class="flex size-full min-h-0 flex-col">
      <ViewTitleRow title="People" navigation={<PeopleNavigation />} />
      <div class="relative flex min-h-0 flex-1">
        <ExperimentalViewSidebar
          label="People navigation"
          collapsed={viewSidebarCollapsed()}
        >
          <PeopleNavigation />
        </ExperimentalViewSidebar>
        <ListContentContainer>
          <ResponsiveListControls />
          <Body adjacentToSidebar />
        </ListContentContainer>
      </div>
    </div>
  );

  return (
    <div class="@container/experimental-soup flex size-full min-h-0 flex-col bg-panel">
      <Switch fallback={<Body />}>
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
        <Match when={props.view === 'people'}>
          <PeopleLayout />
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
    mail: 'email',
    documents: 'library',
    agents: 'machines',
    tasks: 'tasks',
    channels: 'people',
    companies: 'people',
  };
  return mapping[args.contentId as ListView];
}
