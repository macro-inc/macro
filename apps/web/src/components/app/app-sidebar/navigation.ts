import { getDocumentsFilterSplit } from '@app/features/next-soup/soup-view/documents-filter-controllers';
import { globalSplitManager } from '@app/signal/splitLayout';
import { CALENDAR_BLOCK_ID } from '@block-calendar/types';
import type { useSplitLayout } from '@components/app/split-layout/layout';
import type {
  ReferredFrom,
  SplitContent,
  SplitHandle,
} from '@components/app/split-layout/layoutManager';
import type { SidebarItem } from './links';

type OpenWithSplitFn = ReturnType<typeof useSplitLayout>['openWithSplit'];

const isMarkdownDocumentsParams = (
  params: SidebarItem['params'] | undefined
): boolean => {
  const initialClientFilters = params?.initialClientFilters as
    | { or?: readonly unknown[] }
    | undefined;

  return initialClientFilters?.or?.includes('doc-markdown') ?? false;
};

export function sidebarContent(
  viewId: SidebarItem['id'],
  params?: SidebarItem['params']
): SplitContent {
  return viewId === 'calendar'
    ? { type: 'calendar', id: CALENDAR_BLOCK_ID }
    : { type: 'component', id: viewId, params };
}

/**
 * Navigate to a sidebar view by pushing a fresh entry into the active split.
 * Holding shift opens it in a new split. Use in-app back/forward to return to
 * prior entries.
 */
export function navigateToSidebarView(args: {
  viewId: SidebarItem['id'];
  params?: SidebarItem['params'];
  shiftKey: boolean;
  activeSplit: SplitHandle | undefined;
  openWithSplit: OpenWithSplitFn;
  referredFrom?: ReferredFrom;
}): SplitHandle | undefined {
  const { viewId, params, shiftKey, activeSplit, openWithSplit, referredFrom } =
    args;

  const activeContent = activeSplit?.content();
  if (
    !shiftKey &&
    isMarkdownDocumentsParams(params) &&
    activeContent?.type === 'component' &&
    activeContent.id === 'documents'
  ) {
    const controller = activeSplit
      ? getDocumentsFilterSplit(activeSplit.id)
      : undefined;
    if (controller) {
      controller.toggleMarkdownFilter();
      return activeSplit;
    }
  }

  return openWithSplit(sidebarContent(viewId, params), {
    preferNewSplit: shiftKey,
    mergeHistory: false,
    allowDuplicate: viewId !== 'calendar',
    referredFrom,
  });
}

/**
 * Whether a sidebar destination is what the active split currently shows.
 * Shared by the expanded sidebar rows and the skinny rail so one click can't
 * highlight in one and not the other. Pass the live `useLocation().pathname`:
 * it is the fallback for the window between mount and the split layout
 * registering its manager.
 */
export function isSidebarViewActive(
  viewId: SidebarItem['id'],
  params: SidebarItem['params'] | undefined,
  pathname: string
): boolean {
  // Always read the manager signal live: it is undefined until the split
  // layout mounts, which happens after the sidebar.
  const activeContent = globalSplitManager()?.activeSplit()?.content();
  if (!activeContent) {
    return pathname.split('/').filter(Boolean).includes(viewId);
  }

  const expectedContent = sidebarContent(viewId, params);
  return (
    activeContent.type === expectedContent.type &&
    activeContent.id === expectedContent.id
  );
}
