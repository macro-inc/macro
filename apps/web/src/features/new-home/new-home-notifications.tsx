import { SidebarCreateHeader } from '@app/components/view-shell/SidebarCreateButton';
import { HomeChatStart } from '@app/features/home/components/HomeChatStart';
import { InboxDisplayMenu } from '@app/features/notifications-inbox/components/inbox-display-menu';
import { NotificationsInbox } from '@app/features/notifications-inbox/notifications-inbox';
import { t } from '@app/lib/i18n';
import { useNavigate } from '@app/lib/split-router';
import { homePreviewRoute } from '@app/routes/routes';
import { useSettingsState } from '@core/constant/SettingsState';
import { fireAndForget } from '@core/util/fireAndForget';
import { NEW_HOME_LIST, seedNewHomeListWidth } from './new-home-list';
import { NEW_HOME_RECENT_SEARCH, useNewHomeTitle } from './new-home-navigation';
import { createCondensedPreference } from './new-home-preferences';
import { NewHomeTabBar } from './new-home-tab-bar';

/**
 * New Home's Notifications tab: the notifications inbox under New Home's
 * header and tabs, with Display options in place of Settings and Home's
 * composer while nothing is open.
 */
export function NewHomeNotificationsView() {
  seedNewHomeListWidth();
  const title = useNewHomeTitle();
  const { condensed, setCondensed } = createCondensedPreference();
  const { openSettings } = useSettingsState();
  const navigate = useNavigate();
  // A chat started here is recent work: it opens on the Recent tab.
  const showStartedSession = (sessionId: string) =>
    fireAndForget(
      navigate(
        {
          route: homePreviewRoute,
          params: { blockType: 'agent', previewId: sessionId },
        },
        { search: NEW_HOME_RECENT_SEARCH }
      ),
      'new-home'
    );

  return (
    <NotificationsInbox
      frame={{
        title,
        condensed,
        list: NEW_HOME_LIST,
        header: (controls) => (
          <>
            <SidebarCreateHeader
              title={title()}
              label={t('home.newChat')}
              createText={t('home.newChat')}
              onCreate={controls.closePreview}
              actions={
                <>
                  {controls.actions}
                  <InboxDisplayMenu
                    condensed={condensed()}
                    onCondensedChange={setCondensed}
                    onOpenSettings={() => openSettings('Notifications')}
                  />
                </>
              }
            />
            <NewHomeTabBar tab="notifications" />
          </>
        ),
        idle: () => (
          <HomeChatStart
            title={title()}
            onStartedSession={showStartedSession}
            // The inbox's Enter opens its focused row, as it does today.
            shareEnter
          />
        ),
      }}
    />
  );
}
