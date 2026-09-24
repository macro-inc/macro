import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { PublicOnboarding } from '@app/features/setup/views/PublicOnboarding';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { useIsAuthenticated } from '@core/context/user';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { Show } from 'solid-js';
import { Login } from './Login';

/** Web signup asks for Google access after the welcome and security screens. */
export function SignupEntry() {
  const analytics = useAnalytics();
  const authenticated = useIsAuthenticated();
  // Keep the native sign-in experience, including Apple's iOS requirement.
  if (isNativeMobilePlatform()) return <Login signupMode />;
  const loginUrl = new URL(
    `${ROUTER_BASE_CONCAT}login${window.location.search}`,
    window.location.origin
  );
  // A callback belongs to Login, which redeems its session code before setup.
  const hasCallback = loginUrl.searchParams.has('token');
  const requestedWorkLogin =
    loginUrl.searchParams.get('onboarding') === 'google-work';
  return (
    <Show
      when={hasCallback || requestedWorkLogin || authenticated() !== undefined}
      fallback={<LoadingBlock />}
    >
      <Show
        when={!hasCallback && !requestedWorkLogin && !authenticated()}
        fallback={<Login signupMode />}
      >
        <PublicOnboarding
          loginUrl={loginUrl.toString()}
          onFeaturesSelected={(features) =>
            analytics.track('onboarding_v4_features_selected', {
              features,
              feature_count: features.length,
              source: 'public_onboarding',
            })
          }
        />
      </Show>
    </Show>
  );
}
