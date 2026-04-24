import { Panel } from '@ui';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { PcNoiseGrid } from '@core/component/PcNoiseGrid';
import { toast } from '@core/component/Toast/Toast';
import { useEmailLinks } from '@core/email-link';
import { useUserInfo } from '@queries/auth';
import { useNavigate } from '@solidjs/router';
import { onMount, Show } from 'solid-js';
import { useAnalytics } from '@app/component/analytics-context';
import LogoIcon from '@macro-icons/macro-logo.svg';
import { LoginOptions } from './LoginOptions';
import type { Stage } from './Shared';

function PostSignupRedirect() {
  const navigate = useNavigate();
  const { initEmailLink } = useEmailLinks();

  onMount(async () => {
    await initEmailLink().match(
      () => {},
      (err) => {
        if (err.tag !== 'AlreadyInitialized') {
          toast.alert(
            'Failed to connect email',
            'Select email permissions on sign-in to enable'
          );
        }
      }
    );
    navigate('/', {
      replace: true,
    });
  });

  return <LoadingBlock />;
}

export function Signup() {
  const userInfo = useUserInfo();
  const analytics = useAnalytics();

  onMount(() => {
    analytics.pageView('signup');
  });

  return (
    <Show when={!userInfo()?.authenticated} fallback={<PostSignupRedirect />}>
      <div class="flex items-center justify-center h-full w-full p-8 overflow-hidden relative">
        <style>
          {
            /*css*/ `
          @keyframes login-fade-up {
            from { opacity: 0; transform: translateY(8px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .login-card {
            animation: login-fade-up 300ms ease-out both;
          }
          .login-stagger > * {
            animation: login-fade-up 300ms ease-out both;
          }
          .login-stagger > *:nth-child(1) { animation-delay: 50ms; }
          .login-stagger > *:nth-child(2) { animation-delay: 120ms; }
          .login-stagger > *:nth-child(3) { animation-delay: 190ms; }
          .login-stagger > *:nth-child(4) { animation-delay: 260ms; }
          `
          }
        </style>
        <div class="inset-0 absolute text-edge bg-panel opacity-10 -z-1">
          <PcNoiseGrid
            cellSize={30}
            warp={0}
            crunch={0.2}
            freq={0.001}
            size={[0, 0.3]}
            rounding={0}
            fill={0}
            stroke={1}
            speed={[0.017, 0.209]}
          />
        </div>

        <div class="w-full max-w-105 login-card">
          <Panel>
            <div class="login-stagger">
              <div class="flex items-center justify-center py-10">
                <LogoIcon class="size-20 text-accent" />
              </div>
              <div class="text-center text-lg font-medium">
                Welcome to Macro
              </div>
              <div class="px-8 pb-4 pt-2 text-center text-sm text-ink/60 leading-relaxed">
                Sign up with Google to sync your inbox and set up your
                workspace.
              </div>
              <div class="w-full">
                <LoginOptions signupMode setStage={(_stage: Stage) => {}} />
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </Show>
  );
}
