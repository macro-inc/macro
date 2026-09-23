import type { ListFilterGroup } from '@app/components/view-shell';
import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useTagFilterGroup } from '@property/tags/use-tag-filter-group';
import { useContacts } from '@queries/contacts/contacts';
import { createMemo } from 'solid-js';
import { useDriveView } from '../context/drive-context';

export type DriveFilterGroupId = 'type' | 'created-by' | 'tags' | 'scope';

const typeOptions = [
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

/** Filter model shared by the desktop filter dropdown and the mobile drawer. */
export function useDriveFilters() {
  const { state, actions } = useDriveView();

  const userId = actions.userId;

  const contacts = useContacts();

  const tagGroup = useTagFilterGroup();

  const people = createMemo(() => {
    const sorted = [...contacts()].sort(
      (a, b) => Number(b.id === userId()) - Number(a.id === userId())
    );

    return sorted.map((person) => {
      let label = person.name || person.id;

      if (person.id === userId()) {
        label = person.name ? `${person.name} (me)` : 'Me';
      }

      return {
        id: person.id,
        label,

        icon: () => (
          <UserIcon
            id={person.id}
            size="sm"
            suppressClick
            showTooltip={false}
          />
        ),
      };
    });
  });

  const showCreators = () => {
    const { location, scope } = state.value();

    if (location.kind === 'folder') return true;

    return location.tab !== 'owned' || scope !== 'default';
  };

  const groups = createMemo(() => {
    const groups: ListFilterGroup<DriveFilterGroupId, string>[] = [];

    const location = state.value().location;

    const isRecent = location.kind === 'tab' && location.tab === 'recent';

    if (!isRecent) {
      const tags = tagGroup();

      if (tags.options.length > 0) groups.push(tags);

      groups.push({
        id: 'type',
        label: 'Type',
        options: typeOptions.map((option) => ({
          id: option.id,
          label: option.label,

          icon: () => <EntityIcon targetType={option.type} size="xs" />,
        })),
      });

      if (showCreators()) {
        groups.push({
          id: 'created-by',
          label: 'Created by',
          searchPlaceholder: 'Search creators...',
          options: people(),
        });
      }
    }

    groups.push({
      id: 'scope',
      label: 'Files',
      selectionMode: 'single',
      defaultOptionId: 'default',
      options: [
        { id: 'default', label: 'Default' },
        { id: 'all', label: 'All files' },
        { id: 'attachments', label: 'Email attachments' },
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

    state.setFacetSelected(group, id, selected);
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
    isSelected,
    setSelected,
    activeCount,
    clear: state.clearFilters,
  };
}
