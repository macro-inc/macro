import { t } from '@app/lib/i18n';
import { useNavigate } from '@app/lib/split-router';
import { forYouRoute } from '@app/routes/routes';
import { useUserContext } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { type ComponentProps, Show } from 'solid-js';
import type { FeedItem } from '../for-you/core/feed';
import { createFeedSource } from '../for-you/queries/feed-source';
import { createFeedPreferences } from '../for-you/queries/preferences';
import { HomeFocusView } from './views/home-focus-view';

type HomeFocusProps = Omit<
  ComponentProps<typeof HomeFocusView>,
  'source' | 'preferences' | 'onOpen' | 'onOpenFeed'
>;

function LiveHomeFocus(props: HomeFocusProps & { userId: string }) {
  const navigate = useNavigate();
  const preferences = createFeedPreferences(
    props.userId,
    t('forYou.defaultPrompt')
  );
  const source = createFeedSource(props.userId, preferences.prompt);
  const openFeed = (item?: FeedItem) =>
    fireAndForget(
      navigate(
        { route: forYouRoute },
        {
          search: item ? { forYou: { item: [item.id] } } : undefined,
          allowDuplicate: true,
        }
      ),
      'home-focus'
    );
  return (
    <HomeFocusView
      {...props}
      source={source}
      preferences={preferences}
      onOpen={openFeed}
      onOpenFeed={() => openFeed()}
    />
  );
}

export function HomeFocus(props: HomeFocusProps) {
  const user = useUserContext();
  return (
    <Show when={user.userId()} keyed>
      {(userId) => <LiveHomeFocus {...props} userId={userId} />}
    </Show>
  );
}
