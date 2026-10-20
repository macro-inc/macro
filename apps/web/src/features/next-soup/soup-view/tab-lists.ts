import type { ListView } from '@app/constants/list-views';
import { type TranslationKey, t } from '@app/lib/i18n';
import type { TabItem } from '@core/component/Tabs';

/** Views that have tab definitions. Shared between VIEW_TAB_LISTS and VIEW_TAB_PRESETS. */
export type TabbedListView = Extract<
  ListView,
  | 'home'
  | 'agents'
  | 'mail'
  | 'documents'
  | 'tasks'
  | 'channels'
  | 'calls'
  | 'folders'
>;

/** A tab whose label is translated each time it renders; `value` stays an English id. */
const tab = (value: string, key: TranslationKey): TabItem => ({
  value,
  get label() {
    return t(key);
  },
});

/** Tab definitions for each list view. */
export const VIEW_TAB_LISTS: Record<TabbedListView, TabItem[]> = {
  home: [
    tab('signal', 'viewMenus.signal'),
    tab('noise', 'viewMenus.noise'),
    tab('all', 'viewMenus.all'),
    // Hidden from every tab surface for unflagged users (see
    // `useVisibleViewTabs`); listed here so the tab/preset consistency tests
    // still cover it.
  ],
  agents: [
    tab('owned', 'viewMenus.owned'),
    tab('running', 'viewMenus.running'),
    tab('shared', 'viewMenus.shared'),
    tab('routines', 'viewMenus.routines'),
    tab('skills', 'viewMenus.skills'),
  ],
  mail: [
    tab('important', 'viewMenus.signal'),
    tab('noise', 'viewMenus.noise'),
    tab('sent', 'viewMenus.sent'),
    tab('calendar', 'viewMenus.calendar'),
    tab('drafts', 'viewMenus.drafts'),
    tab('shared', 'viewMenus.shared'),
    tab('all', 'viewMenus.all'),
  ],
  documents: [
    tab('owned', 'viewMenus.owned'),
    tab('shared', 'viewMenus.shared'),
    tab('attachments', 'viewMenus.attachments'),
    tab('folders', 'viewMenus.folders'),
    tab('all', 'viewMenus.all'),
  ],
  tasks: [tab('my-tasks', 'viewMenus.myTasks'), tab('all', 'viewMenus.all')],
  channels: [
    tab('recent', 'viewMenus.recent'),
    tab('people', 'viewMenus.people'),
    tab('teams', 'viewMenus.teams'),
  ],
  calls: [
    tab('all', 'viewMenus.all'),
    tab('missed', 'viewMenus.missed'),
    tab('unattended', 'viewMenus.unattended'),
  ],
  folders: [tab('owned', 'viewMenus.owned'), tab('all', 'viewMenus.all')],
};
