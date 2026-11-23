import { useViewTabHotkeys } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useNavigationUnread } from '@components/app/use-navigation-unread';
import { useUserId } from '@core/context/user';
import { createEffect, createSignal } from 'solid-js';
import { NewHomeTabs } from './components/new-home-tabs';
import type { NewHomeTab } from './core/new-home-mode';
import { useNewHomeNavigation } from './new-home-navigation';
import { saveNewHomeTab } from './new-home-preferences';

const NEW_HOME_TABS: readonly NewHomeTab[] = ['recent', 'notifications'];

/**
 * New Home's Recent and Notifications switch, under its header. Tab,
 * Shift+Tab, `1` and `2` move between the two; Notifications' All and Unread
 * are a filter row under them, not part of it. The tab shown is the one New
 * Home opens on next.
 */
export function NewHomeTabBar(props: { tab: NewHomeTab }) {
  const panel = useSplitPanelOrThrow();
  const userId = useUserId();
  const unread = useNavigationUnread();
  const goTo = useNewHomeNavigation();
  const [tabs, setTabs] = createSignal<HTMLElement>();

  // The split in use decides the tab New Home opens on next.
  createEffect(() => {
    const id = userId();
    if (id && panel.isPanelActive()) saveNewHomeTab(id, props.tab);
  });

  const show = (tab: NewHomeTab) => {
    if (tab !== props.tab) goTo(tab);
  };

  useViewTabHotkeys<NewHomeTab>({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    tabs,
    ids: () => NEW_HOME_TABS,
    activeId: () => props.tab,
    setActiveId: show,
    label: (tab) =>
      tab === 'recent' ? t('home.recent') : t('home.notifications'),
  });

  return (
    <NewHomeTabs
      ref={setTabs}
      value={props.tab}
      unread={unread.has('new-home')}
      onChange={show}
    />
  );
}
