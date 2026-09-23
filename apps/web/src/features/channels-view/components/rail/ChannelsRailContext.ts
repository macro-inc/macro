import type { ListController } from '@app/components/list';
import type { ChannelPreviewSelection } from '@app/features/next-soup/utils';
import { createAssertedContextProvider } from '@core/context/createContext';
import type { ChannelEntity } from '@entity';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import type { ContextProviderProps } from '@solid-primitives/context';
import type { Accessor } from 'solid-js';
import type { VirtualizerHandle } from 'virtua/solid';
import type { ChannelsSourceScope, ChannelsSources } from '../../queries';
import type {
  ChannelListSort,
  ChannelsGroup,
  ChannelsRailSection,
  ChannelsTab,
} from '../../types';
import type { useChannelRailActivity } from './hooks/useChannelRailActivity';

type ChannelRailActivity = ReturnType<typeof useChannelRailActivity>;

export type ChannelRailRow =
  | {
      kind: 'section';
      id: `section:${ChannelsRailSection}`;
      group: ChannelsRailSection;
    }
  | {
      kind: 'favorite';
      id: `favorite:${string}`;
      group: 'favorites';
      favorite: Favorite;
    }
  | {
      /** A team channel label heading inside the Channels section. */
      kind: 'label';
      id: `label:${string}`;
      group: 'channels';
      /** Index in the Channels section's rendered rows (labels and channels). */
      localIndex: number;
      label: ChannelLabel;
    }
  | {
      kind: 'conversation';
      id: `channel:${string}`;
      group?: ChannelsGroup;
      scope: ChannelsSourceScope;
      /**
       * Index in the scope's rendered list. For `channels` that list mixes
       * label headings and channels, so it is not an index into the source.
       */
      localIndex: number;
      channel: ChannelEntity;
      /** The label this row is nested under, when any. */
      labelId?: string;
    };

/**
 * One rendered row of the Channels section: a label heading or a channel,
 * nested (`labelId` set) or in the plain list below the labels.
 */
export type ChannelSectionRow =
  | { kind: 'label'; label: ChannelLabel }
  | { kind: 'conversation'; channel: ChannelEntity; labelId?: string };

/** Payload of a channel row being dragged to or out of a label (solid-dnd). */
export type ChannelLabelDragData = {
  dragType: 'channel-label';
  dndScope: string;
  channelId: string;
  /** The label the channel is currently in, when any. */
  labelId?: string;
  /** Shown by the global drag overlay. */
  name: string;
  iconType: 'channel';
};

/** Where a dragged channel may land. */
export type ChannelLabelDropTarget =
  | { kind: 'label'; labelId: string }
  | { kind: 'smart-tag'; labelId: string }
  | { kind: 'channel'; channelId: string }
  | { kind: 'unlabelled' };

/** Payload of a drop target in the Channels section (solid-dnd). */
export type ChannelLabelDropData = {
  dragType: 'channel-label-target';
  dndScope: string;
  target: ChannelLabelDropTarget;
  /** Read by the `pointerWithin` collision detector. */
  isDropTargetDisabled: () => boolean;
};

export const rowKeyForChannel = (channelId: string, labelId?: string) =>
  `channel:${channelId}${labelId ? `:label:${labelId}` : ''}` as const;

export const rowKeyForFavorite = (favorite: Favorite) =>
  `favorite:${favorite.entityType}:${favorite.entityId}` as const;

export const rowKeyForSection = (group: ChannelsRailSection) =>
  `section:${group}` as const;

export const rowKeyForLabel = (labelId: string) => `label:${labelId}` as const;

export const domIdForRow = (railId: string, rowId: string) =>
  `${railId}-${rowId}`;

export type ChannelRailActivationMetadata = {
  event?: MouseEvent;
  newSplit?: boolean;
};

export type ChannelsRailContext = {
  railId: string;
  list: ListController<ChannelRailRow, ChannelRailActivationMetadata>;
  tab: Accessor<ChannelsTab>;
  selectTab: (tab: ChannelsTab) => void;
  sources: ChannelsSources;
  favorites: Accessor<readonly Favorite[]>;
  selectedChannel: Accessor<ChannelPreviewSelection | undefined>;
  isGroupOpen: (group: ChannelsRailSection) => boolean;
  toggleGroup: (group: ChannelsRailSection) => void;
  /** Whether channel labels and smart tags are enabled for this user. */
  channelTagsEnabled: Accessor<boolean>;
  /** Every label in the authorized scope, including empty labels. */
  labels: Accessor<readonly ChannelLabel[]>;
  /** Whether labels can be used after loading successfully. */
  labelsAvailable: Accessor<boolean>;
  /** Why labels are unavailable, for the create menu and refused drops. */
  labelsUnavailableReason: Accessor<string>;
  isLabelOpen: (labelId: string) => boolean;
  toggleLabel: (labelId: string) => void;
  /** The Channels section's rendered rows: label headings and channels. */
  channelSectionRows: Accessor<readonly ChannelSectionRow[]>;
  /** Number of channels in the label with unread activity. */
  labelUnreadCount: (label: ChannelLabel) => number;
  /**
   * Create a label holding `channelIds`, after asking for a name in a dialog
   * that states the team-wide effect. Resolves once the request settles.
   */
  createSmartTag: () => Promise<void>;
  editSmartTag: (label: ChannelLabel) => Promise<void>;
  createLabel: (channelIds: string[]) => Promise<void>;
  /** Rename after asking for the new name in a dialog; applies to the whole team. */
  renameLabel: (label: ChannelLabel) => Promise<void>;
  /** Delete after the user confirms; applies to the whole team. */
  deleteLabel: (label: ChannelLabel) => Promise<void>;
  /** Move a channel into a label, or out of any label (`undefined`). */
  setChannelLabel: (channelId: string, labelId: string | undefined) => void;
  /** Where a dragged channel would land right now, for highlighting the whole target. */
  activeDropTarget: Accessor<ChannelLabelDropTarget | undefined>;
  /** Mark every unread notification in the label's visible channels read. */
  markLabelRead: (label: ChannelLabel) => void;
  sortBy: (group: ChannelsGroup) => ChannelListSort;
  setSortBy: (group: ChannelsGroup, sort: ChannelListSort) => void;
  registerRootRef: (element: HTMLDivElement) => void;
  activateRow: (rowId: ChannelRailRow['id'], event?: MouseEvent) => void;
  registerScrollRef: (
    group: ChannelsRailSection,
    element: HTMLDivElement
  ) => void;
  registerVirtualizer: (
    scope: ChannelsSourceScope,
    handle: VirtualizerHandle
  ) => () => void;
  channelActivity: ChannelRailActivity;
};

type ChannelsRailProviderProps = ContextProviderProps & {
  value: ChannelsRailContext;
};

export const [ChannelsRailProvider, useChannelsRail] =
  createAssertedContextProvider<ChannelsRailContext, ChannelsRailProviderProps>(
    'ChannelsRail',
    (props) => props.value
  );
