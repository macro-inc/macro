import { useAnalytics } from '@app/lib/analytics/analytics-context';
import LogoIcon from '@icon/macro-logo.svg';
import { useNavigate } from '@solidjs/router';
import { Button, Surface } from '@ui';
import { onMount } from 'solid-js';

/**
 * Native-mobile entry screen shown to unauthenticated users (via `/welcome`).
 * Routes new users into the mobile onboarding wizard and existing users to the
 * standard Login screen.
 */
export function MobileAuthWelcome() {
  const navigate = useNavigate();
  const analytics = useAnalytics();

  onMount(() => {
    analytics.pageView('mobile_auth_welcome');
  });

  return (
    <div class="flex items-center justify-center size-full p-8 overflow-hidden relative">
      <div class="w-full max-w-105">
        <Surface depth={1}>
          <div class="flex flex-col items-center gap-2 py-10">
            <LogoIcon class="size-20 text-ink" />
            <div class="text-lg font-medium">Welcome to Macro</div>
          </div>
          <div class="flex flex-col gap-3 px-8 pb-8">
            <Button
              variant="strong"
              size="xl"
              onClick={() => navigate('/onboarding')}
            >
              Create new account
            </Button>
            <Button
              size="xl"
              class="border border-edge-muted"
              onClick={() => navigate('/login')}
            >
              Log into existing account
            </Button>
          </div>
        </Surface>
      </div>
    </div>
  );
}
