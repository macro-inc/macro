import { t } from '@app/lib/i18n';
import type { ProjectScope } from '../core/project';

/** Shared built-in destinations for the desktop tabs and phone pill strip. */
export const PROJECT_VIEW_OPTIONS = [
  {
    value: 'assigned-to-me',
    get label() {
      return t('viewMenus.myProjects');
    },
  },
  {
    value: 'all',
    get label() {
      return t('viewMenus.allProjects');
    },
  },
  {
    value: 'created-by-me',
    get label() {
      return t('viewMenus.createdByMe');
    },
  },
] as const satisfies readonly { value: ProjectScope; label: string }[];
