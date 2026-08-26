import { ExperimentalActivityView as ExperimentalActivityViewV1 } from '@app/features/experimental-app-layout/experimental-activity-view';
import { ExperimentalAppSidebar as ExperimentalAppSidebarV1 } from '@app/features/experimental-app-layout/experimental-app-sidebar';
import { ExperimentalAutomationCard as ExperimentalAutomationCardV1 } from '@app/features/experimental-app-layout/experimental-automation-card';
import { ExperimentalChatView as ExperimentalChatViewV1 } from '@app/features/experimental-app-layout/experimental-chat-view';
import { ExperimentalGroupHeader as ExperimentalGroupHeaderV1 } from '@app/features/experimental-app-layout/experimental-group-header';
import { ExperimentalListEntity as ExperimentalListEntityV1 } from '@app/features/experimental-app-layout/experimental-list-entity';
import {
  ExperimentalSoupLayout as ExperimentalSoupLayoutV1,
  experimentalSoupViewForContent as experimentalSoupViewForContentV1,
} from '@app/features/experimental-app-layout/experimental-soup-layout';
import { ExperimentalActivityView as ExperimentalActivityViewV2 } from '@app/features/experimental-app-layout-v2/experimental-activity-view';
import { ExperimentalAppSidebar as ExperimentalAppSidebarV2 } from '@app/features/experimental-app-layout-v2/experimental-app-sidebar';
import { ExperimentalAutomationCard as ExperimentalAutomationCardV2 } from '@app/features/experimental-app-layout-v2/experimental-automation-card';
import { ExperimentalChatView as ExperimentalChatViewV2 } from '@app/features/experimental-app-layout-v2/experimental-chat-view';
import { ExperimentalGroupHeader as ExperimentalGroupHeaderV2 } from '@app/features/experimental-app-layout-v2/experimental-group-header';
import { ExperimentalListEntity as ExperimentalListEntityV2 } from '@app/features/experimental-app-layout-v2/experimental-list-entity';
import {
  ExperimentalSoupLayout as ExperimentalSoupLayoutV2,
  experimentalSoupViewForContent as experimentalSoupViewForContentV2,
} from '@app/features/experimental-app-layout-v2/experimental-soup-layout';
import { ExperimentalAppTopBar } from '@app/features/experimental-app-layout-v3/experimental-app-topbar';
import { ExperimentalAppBottomBar } from '@app/features/experimental-app-layout-v4/experimental-app-bottombar';
import type { SidebarState } from '@components/app/app-sidebar/sidebar';
import type { ActivityEvent } from '@queries/activity/graphql/entity';
import type { Component, ParentProps } from 'solid-js';
import type { AppLayoutId } from './layout-registry';
import { effectiveAppLayoutId } from './layout-state';

export type AppSidebarSurfaceProps = {
  sidebarState?: SidebarState;
  onOpenChange: (open: boolean) => void;
  overlayOpen?: boolean;
  onOverlayOpenChange?: (open: boolean) => void;
};

export type ActivityViewSurfaceProps = ParentProps<{
  events?: ActivityEvent[];
  isLoading?: boolean;
  isError?: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onFetchNextPage?: () => void;
}>;

export type AppLayoutSurfaces = {
  /**
   * Layouts hang their app chrome off exactly one of these: `AppSidebar` for a
   * vertical rail beside the splits, `AppTopBar` for a bar above them,
   * `AppBottomBar` for a floating dock hovering over their bottom edge.
   */
  AppSidebar?: Component<AppSidebarSurfaceProps>;
  AppTopBar?: Component;
  AppBottomBar?: Component;
  ActivityView: Component<ActivityViewSurfaceProps>;
  ChatView: Component;
  SoupLayout: Component<any>;
  SoupListEntity: Component<any>;
  SoupGroupHeader: Component<any>;
  SoupAutomationCard: Component<any>;
  resolveSoupView: (args: { contentId: string; requestedView?: any }) => any;
};

const APP_LAYOUT_SURFACES: Partial<Record<AppLayoutId, AppLayoutSurfaces>> = {
  'experimental-v1': {
    AppSidebar: ExperimentalAppSidebarV1,
    ActivityView: ExperimentalActivityViewV1,
    ChatView: ExperimentalChatViewV1,
    SoupLayout: ExperimentalSoupLayoutV1,
    SoupListEntity: ExperimentalListEntityV1,
    SoupGroupHeader: ExperimentalGroupHeaderV1,
    SoupAutomationCard: ExperimentalAutomationCardV1,
    resolveSoupView: experimentalSoupViewForContentV1,
  },
  'experimental-v2': {
    AppSidebar: ExperimentalAppSidebarV2,
    ActivityView: ExperimentalActivityViewV2,
    ChatView: ExperimentalChatViewV2,
    SoupLayout: ExperimentalSoupLayoutV2,
    SoupListEntity: ExperimentalListEntityV2,
    SoupGroupHeader: ExperimentalGroupHeaderV2,
    SoupAutomationCard: ExperimentalAutomationCardV2,
    resolveSoupView: experimentalSoupViewForContentV2,
  },
  // V3 keeps every V2 content surface and swaps the sidebar for a top bar.
  'experimental-v3': {
    AppTopBar: ExperimentalAppTopBar,
    ActivityView: ExperimentalActivityViewV2,
    ChatView: ExperimentalChatViewV2,
    SoupLayout: ExperimentalSoupLayoutV2,
    SoupListEntity: ExperimentalListEntityV2,
    SoupGroupHeader: ExperimentalGroupHeaderV2,
    SoupAutomationCard: ExperimentalAutomationCardV2,
    resolveSoupView: experimentalSoupViewForContentV2,
  },
  // V4 keeps every V2 content surface and swaps the chrome for a Fey-style
  // floating bottom dock.
  'experimental-v4': {
    AppBottomBar: ExperimentalAppBottomBar,
    ActivityView: ExperimentalActivityViewV2,
    ChatView: ExperimentalChatViewV2,
    SoupLayout: ExperimentalSoupLayoutV2,
    SoupListEntity: ExperimentalListEntityV2,
    SoupGroupHeader: ExperimentalGroupHeaderV2,
    SoupAutomationCard: ExperimentalAutomationCardV2,
    resolveSoupView: experimentalSoupViewForContentV2,
  },
};

export const activeAppLayoutSurfaces = () =>
  APP_LAYOUT_SURFACES[effectiveAppLayoutId()];
