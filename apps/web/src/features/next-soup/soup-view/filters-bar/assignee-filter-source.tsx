import { t } from '@app/lib/i18n';
import CircleDashedIcon from '@icon/system/regular/circle-dashed.svg';
import { NO_ASSIGNEE } from '../../filters';
import type { SearchableOption } from './searchable-multi-select';

export function unassignedFilterOption(): SearchableOption {
  return {
    id: NO_ASSIGNEE,
    label: t('viewMenus.unassigned'),
    icon: () => <CircleDashedIcon class="size-3.5 text-ink-muted" />,
  };
}
