import { ViewShell, ViewSidebar } from '@app/components/view-shell';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { enableForYou } from '@core/constant/featureFlags';
import { useUserContext } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Match, Show, Switch } from 'solid-js';
import { feedActions } from './actions';
import { createFeedSource } from './queries/feed-source';
import { createFeedPreferences } from './queries/preferences';
import { ForYouView } from './views/for-you-view';

function LiveFeed(props: { userId: string }) {
  usePageViewTracking('for-you');
  const preferences = createFeedPreferences(
    props.userId,
    t('forYou.defaultPrompt')
  );
  const source = createFeedSource(props.userId, preferences.prompt);
  return (
    <ViewShell.Root aside={false}>
      <ViewShell.Main>
        <ViewShell.TopBar>
          <ViewSidebar.Title caret={false}>{t('nav.forYou')}</ViewSidebar.Title>
        </ViewShell.TopBar>
        <ForYouView
          source={source}
          preferences={preferences}
          actions={feedActions}
        />
      </ViewShell.Main>
    </ViewShell.Root>
  );
}
export const ForYouRouteView = withAuth(() => {
  const user = useUserContext();
  const flag = useFeatureFlag(enableForYou);
  return (
    <Switch fallback={<RedirectSplit to={{ type: 'component', id: 'home' }} />}>
      <Match when={flag().loading}>
        <LoadingBlock />
      </Match>
      <Match when={flag().enabled && !isTouchDevice()}>
        <Show when={user.userId()} keyed>
          {(userId) => <LiveFeed userId={userId} />}
        </Show>
      </Match>
    </Switch>
  );
});
