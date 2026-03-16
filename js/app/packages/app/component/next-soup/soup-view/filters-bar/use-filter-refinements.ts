import {
  VIEW_TAB_PRESETS,
  type PresetContext,
} from '@app/component/app-sidebar/soup-filter-presets';
import type { FilterID } from '@app/component/next-soup/filters/configs';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { isListViewID } from '@app/constants/list-views';
import { useUserContext } from '@core/context/user';
import { deepEqual } from '@core/util/compareUtils';
import { batch, createMemo } from 'solid-js';
import type { ActiveFilter } from './active-filter-chips';
import { VIEW_FILTER_CATEGORIES } from './unified-filter-dropdown';

// Mapping of filter IDs to human-readable labels and categories
const FILTER_LABELS: Record<string, { category: string; label: string }> = {
  // Entity types
  document: { category: 'Type', label: 'Docs' },
  agent: { category: 'Type', label: 'Agents' },
  people: { category: 'Type', label: 'People' },
  teams: { category: 'Type', label: 'Teams' },
  task: { category: 'Type', label: 'Tasks' },
  email: { category: 'Type', label: 'Mail' },
  file: { category: 'Type', label: 'Files' },
  // Status
  unread: { category: 'Status', label: 'Unread' },
  read: { category: 'Status', label: 'Read' },
  'not-done': { category: 'Status', label: 'Not Done' },
  done: { category: 'Status', label: 'Done' },
  // Attachments
  'has-attachment': { category: 'Attachment', label: 'Has Attachment' },
  'attachment-pdf': { category: 'Attachment', label: 'PDFs' },
  'attachment-image': { category: 'Attachment', label: 'Images' },
  'attachment-document': { category: 'Attachment', label: 'Documents' },
  // Calendar
  'has-calendar-invite': { category: 'Calendar', label: 'Has Invite' },
  // Task status
  'task-not-started': { category: 'Status', label: 'Not Started' },
  'task-in-progress': { category: 'Status', label: 'In Progress' },
  'task-in-review': { category: 'Status', label: 'In Review' },
  'task-completed': { category: 'Status', label: 'Completed' },
  'task-canceled': { category: 'Status', label: 'Canceled' },
  // Task priority
  'task-critical': { category: 'Priority', label: 'Critical' },
  'task-high-priority': { category: 'Priority', label: 'High' },
  'task-medium-priority': { category: 'Priority', label: 'Medium' },
  'task-low-priority': { category: 'Priority', label: 'Low' },
  'task-no-priority': { category: 'Priority', label: 'None' },
  // Document types
  'doc-markdown': { category: 'Type', label: 'Markdown' },
  'doc-canvas': { category: 'Type', label: 'Canvas' },
  // File types
  'file-code': { category: 'Type', label: 'Code' },
  'file-image': { category: 'Type', label: 'Images' },
  'file-pdf': { category: 'Type', label: 'PDFs' },
  'file-other': { category: 'Type', label: 'Other' },
};

// Filter IDs that are set by tabs and should not be shown as removable chips
const TAB_ONLY_FILTERS = new Set([
  'signal',
  'noise',
  'explicit-noise',
  'channels',
  'file-folder',
  'shared-entity',
  'shared-agent',
  'assigned-to',
  'email',
  'no-drafts',
  'email-drafts',
]);

/**
 * Hook that provides detection of active filter refinements beyond tab defaults,
 * and a function to reset filters to the current tab's default state.
 */
export function useFilterRefinements() {
  const {
    soup,
    queryFilters,
    setQueryFilters,
    assigneeFilter,
    setAssigneeFilter,
    activeTab,
  } = useSoupView();
  const panel = useSplitPanelOrThrow();
  const user = useUserContext();

  const getPresetContext = (): PresetContext => ({
    userId: user.userId(),
    email: user.email(),
  });

  const currentView = createMemo(() => {
    const content = panel.handle.content();

    if (content.type !== 'component' || !isListViewID(content.id)) return;

    return content.id;
  });

  const currentPreset = createMemo(() => {
    const view = currentView();
    if (!view) return undefined;

    const viewConfig = VIEW_TAB_PRESETS[view];
    if (!viewConfig) return undefined;

    const tab = activeTab() ?? viewConfig.default;
    const resolver = viewConfig.tabs[tab];
    if (!resolver) return undefined;

    return resolver(getPresetContext());
  });

  const hasActiveRefinements = createMemo(() => {
    const preset = currentPreset();
    if (!preset) return false;

    const expectedIds = new Set([
      ...(preset.clientFilters.and ?? []),
      ...(preset.clientFilters.or ?? []),
    ]);

    const currentIds = new Set(soup.filters.activeIds() as FilterID[]);

    const hasClientFilterDiff =
      expectedIds.size !== currentIds.size ||
      [...expectedIds].some((id) => !currentIds.has(id as FilterID));

    const hasQueryFilterDiff = !deepEqual(queryFilters(), preset.queryFilters);

    const hasSubFilters = assigneeFilter().length > 0;

    return hasClientFilterDiff || hasQueryFilterDiff || hasSubFilters;
  });

  /**
   * Get filter categories for the current view
   */
  const viewCategories = createMemo(() => {
    const view = currentView();
    if (!view) return [];
    return VIEW_FILTER_CATEGORIES[view as ListView] ?? [];
  });

  /**
   * Returns a list of active filters that can be displayed as removable chips.
   * Excludes filters that are set by tabs (like signal/noise).
   */
  const activeFiltersList = createMemo((): ActiveFilter[] => {
    const preset = currentPreset();
    const presetFilterIds = new Set([
      ...(preset?.clientFilters.and ?? []),
      ...(preset?.clientFilters.or ?? []),
    ]);

    const activeIds = soup.filters.activeIds() as string[];
    const filters: ActiveFilter[] = [];
    const categories = viewCategories();

    for (const id of activeIds) {
      // Skip tab-only filters and filters that are part of the current preset
      if (TAB_ONLY_FILTERS.has(id) || presetFilterIds.has(id as FilterID)) {
        continue;
      }

      const labelInfo = FILTER_LABELS[id];
      if (labelInfo) {
        // Find the category options for this filter
        const category = categories.find(
          (c) => c.id === labelInfo.category.toLowerCase()
        );

        filters.push({
          categoryId: labelInfo.category.toLowerCase(),
          categoryLabel: labelInfo.category,
          optionId: id,
          optionLabel: labelInfo.label,
          categoryOptions: category?.options,
        });
      }
    }

    return filters;
  });

  const isOptionActive = (optionId: string) => {
    return soup.filters.isActive(optionId);
  };

  const removeFilter = (_categoryId: string, optionId: string) => {
    soup.filters.toggle({ or: [optionId as FilterID] });
  };

  const replaceFilter = (
    _categoryId: string,
    oldOptionId: string,
    newOptionId: string
  ) => {
    // Toggle off the old filter and toggle on the new one
    batch(() => {
      soup.filters.toggle({ or: [oldOptionId as FilterID] });
      soup.filters.toggle({ or: [newOptionId as FilterID] });
    });
  };

  const resetToTabDefaults = () => {
    const preset = currentPreset();
    if (!preset) return;

    batch(() => {
      soup.filters.set(preset.clientFilters);
      setQueryFilters(preset.queryFilters);
      setAssigneeFilter([]);
    });
  };

  return {
    hasActiveRefinements,
    resetToTabDefaults,
    currentView,
    activeFiltersList,
    removeFilter,
    replaceFilter,
    isOptionActive,
  };
}
