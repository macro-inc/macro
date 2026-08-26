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
import { ExperimentalActivityView as ExperimentalActivityViewV4 } from '@app/features/experimental-app-layout-v4/experimental-activity-view';
import { ExperimentalAppSidebar as ExperimentalAppSidebarV4 } from '@app/features/experimental-app-layout-v4/experimental-app-sidebar';
import { ExperimentalAutomationCard as ExperimentalAutomationCardV4 } from '@app/features/experimental-app-layout-v4/experimental-automation-card';
import { ExperimentalChatView as ExperimentalChatViewV4 } from '@app/features/experimental-app-layout-v4/experimental-chat-view';
import { ExperimentalGlobalTopBar as ExperimentalGlobalTopBarV4 } from '@app/features/experimental-app-layout-v4/experimental-global-top-bar';
import { ExperimentalGroupHeader as ExperimentalGroupHeaderV4 } from '@app/features/experimental-app-layout-v4/experimental-group-header';
import { ExperimentalListEntity as ExperimentalListEntityV4 } from '@app/features/experimental-app-layout-v4/experimental-list-entity';
import {
  ExperimentalSoupLayout as ExperimentalSoupLayoutV4,
  experimentalSoupViewForContent as experimentalSoupViewForContentV4,
} from '@app/features/experimental-app-layout-v4/experimental-soup-layout';
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
  AppSidebar: Component<AppSidebarSurfaceProps>;
  GlobalTopBar?: Component<AppSidebarSurfaceProps>;
  ActivityView: Component<ActivityViewSurfaceProps>;
  ChatView: Component;
  SoupLayout: Component<any>;
  SoupListEntity: Component<any>;
  SoupGroupHeader: Component<any>;
  SoupAutomationCard: Component<any>;
  resolveSoupView: (args: {
    contentId: string;
    requestedView?: any;
  }) => any;
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
  'experimental-v4': {
    AppSidebar: ExperimentalAppSidebarV4,
    GlobalTopBar: ExperimentalGlobalTopBarV4,
    ActivityView: ExperimentalActivityViewV4,
    ChatView: ExperimentalChatViewV4,
    SoupLayout: ExperimentalSoupLayoutV4,
    SoupListEntity: ExperimentalListEntityV4,
    SoupGroupHeader: ExperimentalGroupHeaderV4,
    SoupAutomationCard: ExperimentalAutomationCardV4,
    resolveSoupView: experimentalSoupViewForContentV4,
  },
};

export const activeAppLayoutSurfaces = () =>
  APP_LAYOUT_SURFACES[effectiveAppLayoutId()];
