import { createAssertedContextProvider } from '@core/context/createContext';
import type { ChannelEntity } from '@entity';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { ContextProviderProps } from '@solid-primitives/context';
import type { Accessor, JSX } from 'solid-js';
import type { BrowsePlacement } from '../core/deduplicate-placement';
import type { DmWindowResult } from '../core/dm-window';
import type { FocusModel } from '../core/focus-triage';
import type { SidebarChannel, SidebarSection } from '../core/sidebar-model';
import type { SupportDeskModel } from '../core/support-triage';
import type { JevTriageController } from '../primitives/create-jev-triage';
import type { SidebarPreferencesController } from '../primitives/create-sidebar-preferences';

export type SectionSortMode =
  | 'smart'
  | 'name'
  | 'updated_at'
  | 'viewed_at'
  | 'created_at';

export type SidebarBuiltInGroup = 'favorites' | 'direct_messages' | 'channels';

export type SidebarCreateSectionInput = {
  scope?: 'personal' | 'team';
  channelIds?: string[];
  name?: string;
  ruleContains?: string;
};

export type SidebarWorkspaceContextValue = {
  railId: string;
  channels: Accessor<readonly SidebarChannel[]>;
  channelById: (channelId: string) => SidebarChannel | undefined;
  channelEntityById: (channelId: string) => ChannelEntity | undefined;
  sections: Accessor<readonly SidebarSection[]>;
  rawLabelById: (sectionId: string) => ChannelLabel | undefined;
  favoriteChannelIds: Accessor<readonly string[]>;
  selectedChannelId: Accessor<string | undefined>;
  teamName: Accessor<string | undefined>;
  teamId: Accessor<string | undefined>;
  teamMemberIds: Accessor<ReadonlySet<string>>;
  currentUserId: Accessor<string | undefined>;
  unreadIds: Accessor<ReadonlySet<string>>;
  unreadOrMentionedIds: Accessor<ReadonlySet<string>>;
  mentionCounts: Accessor<ReadonlyMap<string, number>>;
  mutedIds: Accessor<ReadonlySet<string>>;
  activeCallChannelIds: Accessor<ReadonlySet<string>>;
  incomingCallByChannelId: Accessor<ReadonlyMap<string, string>>;
  isLoading: Accessor<boolean>;
  error: Accessor<unknown | undefined>;
  retry: () => void;
  threadsEnabled: Accessor<boolean>;
  canShareSections: Accessor<boolean>;
  labelsAvailable: Accessor<boolean>;
  labelsFailed: Accessor<boolean>;
  labelsUnavailableReason: Accessor<string>;
  retryLabels: () => void;
  prefs: SidebarPreferencesController;
  triage: JevTriageController;

  // Derived workspace models
  placement: Accessor<BrowsePlacement>;
  dmWindow: Accessor<DmWindowResult>;
  dmQuery: Accessor<string>;
  setDmQuery: (query: string) => void;
  /** Optional live search hook for Quick Switch to discover unjoined team channels. */
  setQuickSwitchState?: (open: boolean, query: string) => void;
  discoverableChannels?: Accessor<readonly SidebarChannel[]>;
  supportDesk: Accessor<SupportDeskModel>;
  focusModel: Accessor<FocusModel>;
  totalUnreadCount: Accessor<number>;

  // Collapse, sort, windowing & ordering
  isGroupOpen: (group: SidebarBuiltInGroup) => boolean;
  setGroupOpen: (group: SidebarBuiltInGroup, open: boolean) => void;
  isSectionOpen: (sectionId: string) => boolean;
  setSectionOpen: (sectionId: string, open: boolean) => void;
  /** Current progressive window cap for an expanded section, if expanded beyond default. */
  sectionWindowLimit?: (sectionId: string) => number | undefined;
  /** Expand an open section's visible & fetched window by one page (+25). */
  loadMoreSection?: (sectionId: string) => void;
  /** Reset an expanded section's window back to smart density (8 rows). */
  collapseSectionWindow?: (sectionId: string) => void;
  /** Advance the Support lens fetch window by one page (+25). */
  loadMoreSupport?: () => void;
  /** True when Support sections contain more channels beyond the active window. */
  supportHasMoreWindow?: Accessor<boolean>;
  sectionSort: (sectionId: string) => SectionSortMode | undefined;
  setSectionSort: (sectionId: string, sort: SectionSortMode) => void;
  sectionOrder: Accessor<readonly string[]>;
  setSectionOrder: (order: string[]) => void;

  // Navigation & mutations
  openChannel: (
    channelId: string,
    options?: { newSplit?: boolean; focusComposer?: boolean }
  ) => void;
  prefetchChannel: (channelId: string) => void;
  joinChannel: (channelId: string) => Promise<void>;
  markChannelsRead: (channelIds: readonly string[]) => Promise<void>;
  toggleMuteChannel: (channelId: string, muted: boolean) => Promise<void>;
  toggleFavoriteChannel: (channelId: string, pinned: boolean) => Promise<void>;
  reorderFavorites: (
    sourceChannelId: string,
    targetChannelId: string
  ) => Promise<void>;
  assignChannelToSection: (
    channelId: string,
    sectionId: string | undefined,
    fromSectionId?: string
  ) => Promise<boolean | undefined | void>;
  createSection: (
    input?: SidebarCreateSectionInput
  ) => Promise<string | undefined>;
  editSection: (sectionId: string) => Promise<void>;
  addChannelsToSection: (sectionId: string) => Promise<void>;
  deleteSection: (sectionId: string) => Promise<void>;
  markSectionRead: (sectionId: string) => Promise<void>;
  muteSection: (sectionId: string, muted: boolean) => Promise<void>;
  openCreateChannel: () => void;
  openCreateDm: () => void;

  // Threads integration
  activeTab: Accessor<'browse' | 'threads'>;
  openThreads: () => void;
  exitThreads: () => void;
  threadsChannelId: Accessor<string | undefined>;
  setThreadsChannelId: (channelId: string | undefined) => void;

  // Render slots (live Macro adapters vs standalone E2E fixture)
  renderChannelIcon: (
    channel: SidebarChannel,
    size?: 'sm' | 'md'
  ) => JSX.Element;
  renderLiveCalls?: () => JSX.Element;
  renderCreateMenu?: () => JSX.Element;
  renderRowContextMenu?: (
    channel: SidebarChannel,
    children: JSX.Element
  ) => JSX.Element;
  renderHeaderCloseButton?: () => JSX.Element;
};

type ProviderProps = ContextProviderProps & {
  value: SidebarWorkspaceContextValue;
};

export const [SidebarWorkspaceProvider, useSidebarWorkspace] =
  createAssertedContextProvider<SidebarWorkspaceContextValue, ProviderProps>(
    'SidebarWorkspace',
    (props) => props.value
  );
