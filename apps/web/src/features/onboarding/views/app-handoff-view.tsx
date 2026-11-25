import { fireAndForget } from '@core/util/fireAndForget';
import { onMount } from 'solid-js';
import { AppHandoff } from '../components/app-handoff';
import { OnboardingShell } from '../components/onboarding-shell';
import { useOnboardingContext } from '../context/onboarding-context';
import type { AppHandoff as AppHandoffRequest } from '../core/app-handoff';
import { createAppHandoffLink } from '../primitives/app-handoff-link';

/**
 * Where a sign-up the native app started ends, in place of entering the web
 * app: the account is ready, and the app waits for its session.
 */
export function AppHandoffView(props: { handoff: AppHandoffRequest }) {
  const context = useOnboardingContext();
  const handoff = createAppHandoffLink(context, props.handoff);
  const email = () => {
    const viewer = context.viewer();
    return viewer.t === 'signed-in' ? viewer.viewer.email : undefined;
  };
  onMount(() =>
    context.track('onboarding_v4_app_handoff', { action: 'viewed' })
  );
  return (
    <OnboardingShell>
      <AppHandoff
        link={handoff.link()}
        email={email()}
        onOpen={() => {
          context.track('onboarding_v4_app_handoff', { action: 'open_app' });
          handoff.opened();
        }}
        onRetry={handoff.retry}
        onSwitchAccount={() => {
          context.track('onboarding_v4_app_handoff', {
            action: 'switch_account',
          });
          fireAndForget(context.signOut(), 'onboarding');
        }}
      />
    </OnboardingShell>
  );
}
