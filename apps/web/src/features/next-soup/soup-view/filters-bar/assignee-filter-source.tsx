import { t } from '@app/lib/i18n';
import { useContactFilterOptionsWithEmpty } from '@core/user/use-contact-filter-options';
import CircleDashedIcon from '@icon/system/regular/circle-dashed.svg';
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
) =>
  useContactFilterOptionsWithEmpty(selected, enabled, unassignedFilterOption);
