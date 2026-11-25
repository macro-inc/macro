import type { ListFilterGroup } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { EntityIcon } from '@core/component/EntityIcon';
import {
  useContactFilterLabels,
  useContactFilterOptions,
} from '@core/user/use-contact-filter-options';
import { useTagFilterGroup } from '@property/tags/use-tag-filter-group';
import { createMemo } from 'solid-js';
import { useDriveView } from '../context/drive-context';
import {
  DRIVE_CREATOR_PRESET_ME,
  DRIVE_CREATOR_PRESET_MY_AGENTS,
  DRIVE_CREATOR_PRESET_TEAM_AGENTS,
  type DriveModifiedPresetId,
  isDriveCreatorPreset,
} from '../core/drive-filters';

export type DriveFilterGroupId =
  | 'type'
  | 'created-by'
  | 'modified'
  | 'tags'
  | 'scope';

export const DRIVE_TYPE_FILTER_OPTIONS = [
  { id: 'database', label: 'Database', type: 'database' },
  { id: 'form', label: 'Form', type: 'form' },
  { id: 'doc-markdown', label: 'Markdown', type: 'md' },
  { id: 'doc-canvas', label: 'Canvas', type: 'canvas' },
  { id: 'doc-spreadsheet', label: 'Spreadsheet', type: 'spreadsheet' },
  { id: 'file-code', label: 'Code', type: 'code' },
  { id: 'file-image', label: 'Images', type: 'image' },
  { id: 'file-pdf', label: 'PDFs', type: 'pdf' },
  { id: 'file-docx', label: 'DOCX', type: 'write' },
  { id: 'file-video', label: 'Videos', type: 'video' },
  { id: 'doc-snippet', label: 'Snippets', type: 'snippet' },
  { id: 'doc-skill', label: 'Skills', type: 'skill' },
  { id: 'file-other', label: 'Other', type: 'files' },
] as const;

export function driveModifiedFilterOptions(): readonly {
  id: DriveModifiedPresetId;
  label: string;
}[] {
  return [
    { id: 'today', label: t('drive.filterModifiedToday') },
    { id: 'last-7-days', label: t('drive.filterModifiedLast7Days') },
    { id: 'last-30-days', label: t('drive.filterModifiedLast30Days') },
    { id: 'this-year', label: t('drive.filterModifiedThisYear') },
    { id: 'last-year', label: t('drive.filterModifiedLastYear') },
  ];
}

export function driveCreatorPresetLabel(id: string): string | undefined {
  if (id === DRIVE_CREATOR_PRESET_ME) return t('drive.filterCreatedByMe');
  if (id === DRIVE_CREATOR_PRESET_MY_AGENTS)
    return t('drive.filterCreatedByMyAgents');
  if (id === DRIVE_CREATOR_PRESET_TEAM_AGENTS)
    return t('drive.filterCreatedByTeamAgents');
  return undefined;
}

/** Filter model shared by desktop filter bar/menu and mobile drawer/pills. */
export function useDriveFilters() {
  const { state } = useDriveView();

  const tagGroup = useTagFilterGroup();

  const isRecent = createMemo(() => {
    const location = state.value().location;
    return location.kind === 'tab' && location.tab === 'recent';
  });

  const nonPresetCreatorIds = createMemo(() =>
    (state.value().facets['created-by'] ?? []).filter(
      (id) => !isDriveCreatorPreset(id)
    )
  );
  const contactLabels = useContactFilterLabels(nonPresetCreatorIds);

  const creatorLabel = (id: string) =>
    driveCreatorPresetLabel(id) ?? contactLabels().get(id)?.label ?? id;

  const groups = createMemo(() => {
    const groups: ListFilterGroup<DriveFilterGroupId, string>[] = [];

    if (!isRecent()) {
      const tags = tagGroup();

      if (tags.options.length > 0) groups.push(tags);

      groups.push({
        id: 'type',
        label: t('drive.filterTypeLabel'),
        options: DRIVE_TYPE_FILTER_OPTIONS.map((option) => ({
          id: option.id,
          label: option.label,
          icon: () => <EntityIcon targetType={option.type} size="xs" />,
        })),
      });

      groups.push({
        id: 'created-by',
        label: t('drive.filterCreatorLabel'),
        searchPlaceholder: t('drive.filterPeopleSearchPlaceholder'),
        options: [
          {
            id: DRIVE_CREATOR_PRESET_ME,
            label: t('drive.filterCreatedByMe'),
          },
          {
            id: DRIVE_CREATOR_PRESET_MY_AGENTS,
            label: t('drive.filterCreatedByMyAgents'),
          },
          {
            id: DRIVE_CREATOR_PRESET_TEAM_AGENTS,
            label: t('drive.filterCreatedByTeamAgents'),
          },
        ],
        createSource: useContactFilterOptions,
      });

      groups.push({
        id: 'modified',
        label: t('drive.filterModifiedLabel'),
        selectionMode: 'single',
        options: driveModifiedFilterOptions().map((option) => ({
          id: option.id,
          label: option.label,
        })),
      });
    }

    groups.push({
      id: 'scope',
      label: t('drive.filterSourceLabel'),
      selectionMode: 'single',
      defaultOptionId: 'default',
      options: [
        { id: 'default', label: t('drive.filterSourceDefault') },
        { id: 'all', label: t('drive.filterScopeAll') },
        { id: 'attachments', label: t('drive.filterScopeAttachments') },
      ],
    });

    return groups;
  });

  const setTagSelected = (id: string, selected: boolean) => {
    const ids = (state.value().facets.tags ?? []).filter(
      (value) => value !== id
    );

    if (selected) ids.push(id);

    state.setTags(ids);
  };

  const setModifiedPreset = (id: string | undefined) => {
    const current = state.value().facets.modified ?? [];
    for (const existing of current) {
      if (existing !== id) {
        state.setFacetSelected('modified', existing, false);
      }
    }
    if (id && !current.includes(id)) {
      state.setFacetSelected('modified', id, true);
    }
  };

  const isSelected = (group: DriveFilterGroupId, id: string) => {
    if (group === 'scope') return state.value().scope === id;

    return state.value().facets[group]?.includes(id) ?? false;
  };

  const setSelected = (
    group: DriveFilterGroupId,
    id: string,
    selected: boolean
  ) => {
    if (group === 'scope') {
      if (id === 'default' || id === 'all' || id === 'attachments')
        state.setScope(id);

      return;
    }

    if (group === 'tags') {
      setTagSelected(id, selected);

      return;
    }

    if (group === 'modified') {
      setModifiedPreset(selected ? id : undefined);
      return;
    }

    state.setFacetSelected(group, id, selected);
  };

  const clearGroup = (group: DriveFilterGroupId) => {
    if (group === 'scope') {
      state.setScope('default');
      return;
    }
    if (group === 'tags') {
      state.setTags([]);
      return;
    }
    const existing = state.value().facets[group] ?? [];
    for (const id of existing) {
      state.setFacetSelected(group, id, false);
    }
  };

  const activeCount = () => {
    const { facets, scope } = state.value();

    const facetCount = Object.values(facets).reduce(
      (count, ids) => count + ids.length,
      0
    );

    return facetCount + (scope === 'default' ? 0 : 1);
  };

  return {
    groups,
    tagGroup,
    isRecent,
    creatorLabel,
    isSelected,
    selectedIds: (group: DriveFilterGroupId) =>
      group === 'scope'
        ? [state.value().scope]
        : (state.value().facets[group] ?? []),
    setSelected,
    clearGroup,
    activeCount,
    clear: state.clearFilters,
  };
}
