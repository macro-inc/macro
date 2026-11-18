import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableSuggestions } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { useUserInfo } from '@core/context/user';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { fireAndForget } from '@core/util/fireAndForget';
import { getRecordSuggestionsSeenUrl } from '@service-scheduled-action/generated/client';
import { createEffect } from 'solid-js';

const SCHEDULED_ACTION_HOST: string = SERVER_HOSTS['scheduled-action'];

/**
 * Each app load with Suggestions on tells the backend the person is active,
 * in their time zone, so their nightly suggestions run comes in their night. Once per
 * signed-in person per load; the backend ignores it for free plans.
 */
export function useRecordSuggestionsActivity(): void {
  const userInfo = useUserInfo();
  const suggestions = useFeatureFlag(enableSuggestions);
  let recordedFor: string | undefined;
  createEffect(() => {
    const user = userInfo();
    if (
      !user?.authenticated ||
      !suggestions().enabled ||
      recordedFor === user.id
    ) {
      return;
    }
    recordedFor = user.id;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    fireAndForget(
      fetchWithToken(
        `${SCHEDULED_ACTION_HOST}${getRecordSuggestionsSeenUrl({ timezone })}`,
        { method: 'POST' }
      ),
      'suggestions.record_activity'
    );
  });
}
