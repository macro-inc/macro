import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import type { createOwnedSlots } from '@components/app/split-layout/utils/createOwnedSlots';
import { ok } from 'neverthrow';
import { type Accessor, createContext, useContext } from 'solid-js';

export {
  createCollapsedSidebarSectionsStorage,
  setSidebarSectionCollapsed,
} from '@app/components/view-shell/collapsed-sections';
export { getTaskAssigneeIds } from '@app/features/entity/utils/task-properties';
export { NO_ASSIGNEE } from '@app/features/next-soup/filters/configs/base';
export { testFacets } from '@app/features/soup/filters/facets/evaluate';
export { normalizeFacetSelection } from '@app/features/soup/filters/facets/selection';

export const VIEWER = 'tab-restore-viewer';
export const PanelContext = createContext<{
  handle: SplitHandle;
  replaceOwnedSlot: ReturnType<typeof createOwnedSlots>['replace'];
}>();
export function useSplitPanelOrThrow() {
  const panel = useContext(PanelContext);
  if (!panel) throw new Error('Missing fixture panel');
  return panel;
}
export const useSplitPanel = () => useContext(PanelContext);
export function withSplitPanelOwner<T>(name: string, create: () => T): T {
  return useSplitPanelOrThrow().replaceOwnedSlot(name, create);
}
export const useUserId = () => () => VIEWER;
export const useFeatureFlag = () => () => ({ enabled: false });
export const useTagSets = () => () => [];
export const useTagSetsReady = () => () => true;
export const useTagFilterGroup = () => () => ({
  id: 'tags',
  label: 'Tags',
  options: [],
});
export const useContactFilterLabels = () => () => new Map();
export const useContactFilterOptions = () => ({
  options: () => [],
  visibleIds: () => [],
  search: () => '',
});
export const useQueryAccount = () => () => ({ id: VIEWER, session: 1 });
export const useGlobalNotificationSource = () => undefined;
export const markRowNotificationsSeenOnOpen = () => {};
export function useAssigneePicker(selectedIds: Accessor<string[]>) {
  return {
    options: () => [],
    selectedIdsAtViewEntry: selectedIds,
    placeholder: () => 'Search assignees...',
    onOpenChange: () => {},
    isLoading: () => false,
    isError: () => false,
  };
}
export const AssigneePickerStatus = () => null;
export const PropertyValueIcon = () => <span aria-hidden="true" />;
export const UserIcon = () => <span aria-hidden="true" />;
export const TaskSavedViewActions = () => null;
export const TaskSavedViewCreateBanner = () => null;
export const TaskSavedViewsPicker = () => null;
export const useAiTaskFilterPlan = () => async () => ok({ facets: {} });
export const useTasksDataSource = () => {
  throw new Error('Supply the fixture source');
};
// No document renderer is needed. The real split manager still owns entries,
// captors, navigation guards, and view-resume snapshots.
export const resolveComponent = () => ({ element: undefined });
export const blocks = {};
export const isBlockAlias = () => false;
export const resolveBlockAlias = () => undefined;
export const fileTypeToBlockName = (type: string) => type;
export function createPreviewSelectionGuard() {
  return Object.assign(() => true, { canSelect: () => true });
}
