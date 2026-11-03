import { t } from '@app/lib/i18n';
import { useContactFilterOptions } from '@core/user/use-contact-filter-options';
import CircleDashedIcon from '@icon/system/regular/circle-dashed.svg';
import { useQueryAccount } from '@queries/auth/use-query-account';
import { createMemo } from 'solid-js';
import { NO_ASSIGNEE } from '../../filters';
import type { SearchableOptionSourceFactory } from './option-source';
import type { SearchableOption } from './searchable-multi-select';

export function unassignedFilterOption(): SearchableOption {
  return {
    id: NO_ASSIGNEE,
    label: t('viewMenus.unassigned'),
    icon: () => <CircleDashedIcon class="size-3.5 text-ink-muted" />,
  };
}

/** Unassigned is a local filter value, never a contact lookup or membership row. */
export const useAssigneeFilterOptions: SearchableOptionSourceFactory = (
  selected,
  enabled
) => {
  const ids = createMemo(() => selected().filter((id) => id !== NO_ASSIGNEE));
  const source = useContactFilterOptions(ids, enabled);
  const account = useQueryAccount();
  return {
    ...source,
    options: createMemo(() => {
      const rows = source.options();
      const self = rows.find(
        (row) => row.id.toLowerCase() === account()?.userId
      );
      return [
        ...(self ? [self] : []),
        unassignedFilterOption(),
        ...rows.filter((row) => row !== self),
      ];
    }),
    visibleIds: () => {
      const term = source.search().trim().toLowerCase();
      return unassignedFilterOption().label.toLowerCase().includes(term)
        ? [NO_ASSIGNEE, ...source.visibleIds()]
        : source.visibleIds();
    },
  };
};
