import { onMount, For } from 'solid-js';
import type { JSX } from 'solid-js';
import type { LessonContentProps, LessonDefinition } from '../types';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import EyeSlash from '@phosphor-icons/core/regular/eye-slash.svg?component-solid';
import UsersThree from '@phosphor-icons/core/regular/users-three.svg?component-solid';
import { startSsoLogin } from '@core/auth/sso';
import { initAndStartEmailSync } from '@core/email-link';
import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { isTauri } from '@core/util/platform';
// Singleton is correct here — onContinue/onCompleteParam are plain callbacks outside Solid context.
import { analytics } from '@app/lib/analytics/analytics';

function AboutUsContent(props: LessonContentProps) {
  onMount(() => {
    setTimeout(() => props.onComplete('Connect with Google'));
  });

  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>
        Macro connects to your calendar and inbox for our AI, email client, and
        unified inbox features. We will never share your data or send emails
        without your explicit permission.
      </p>
    </div>
  );
}

const PANELS: { icon: () => JSX.Element; label: string }[] = [
  {
    icon: () => (
      <svg
        viewBox="0 0 48 48"
        fill="none"
        class="size-12 text-accent"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M24 4L6 12v12c0 11.1 7.7 21.5 18 24 10.3-2.5 18-12.9 18-24V12L24 4z"
          fill="currentColor"
          opacity="0.15"
        />
        <path
          d="M24 4L6 12v12c0 11.1 7.7 21.5 18 24 10.3-2.5 18-12.9 18-24V12L24 4z"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linejoin="round"
          fill="none"
        />
        <path
          d="M17 24l5 5 9-10"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    ),
    label: 'SOC 2 certified and pen tested',
  },
  {
    icon: () => <EyeSlash class="size-12 text-accent" />,
    label: 'Your data is never used to train AI models',
  },
  {
    icon: () => <UsersThree class="size-12 text-accent" />,
    label: 'Trusted by over 200k users',
  },
];

function AboutUsDemo() {
  return (
    <div class="h-full w-full flex items-center justify-center px-8">
      <div
        class="w-full max-w-2xl items-start"
        classList={{
          'flex flex-col gap-3': isTouchDevice(),
          'flex gap-4': !isTouchDevice(),
        }}
      >
        <For each={PANELS}>
          {(panel) => (
            <div class="flex-1 w-full flex flex-col">
              <div class="border border-edge-muted bg-panel rounded-xs overflow-hidden">
                <div class="p-6 flex flex-col items-center gap-4 text-center">
                  {panel.icon()}
                  <p class="text-sm text-ink/70 font-medium">{panel.label}</p>
                </div>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

export const aboutUsLesson: LessonDefinition = {
  id: 'about-us',
  title: 'Security and privacy',
  content: AboutUsContent,
  centeredButton: true,
  demo: AboutUsDemo,
  order: 60,
  onContinue: async () => {
    analytics.track('sign_up', { method: 'google' }, [
      'ga',
      'meta-pixel',
      'posthog',
    ]);

    const success = await startSsoLogin({
      returnPath: `${ROUTER_BASE_CONCAT}welcome?google=1`,
    });
    // On web, startSsoLogin redirects and never resolves.
    // On native mobile, auth completes inline. Reload the page with the
    // return param so it goes through the normal completeOnParam flow —
    // this avoids Suspense blanking the screen when auth state changes.
    if (success) {
      // Reload into the completeOnParam flow. Tauri uses HashRouter so the
      // route + query must go inside the hash fragment.
      if (isTauri()) {
        window.location.hash = '#/welcome?google=1';
        window.location.reload();
      } else {
        window.location.href = `${window.location.origin}${ROUTER_BASE_CONCAT}welcome?google=1`;
      }
    }
    // Never resolves — page reloads (native) or redirects (web).
    return new Promise<boolean>(() => {});
  },
  completeOnParam: 'google',
  onCompleteParam: () =>
    initAndStartEmailSync().match(
      () => {
        analytics.track('email_authorized');
        return true;
      },
      (e) => {
        if (e.tag === 'AlreadyInitialized') {
          analytics.track('email_authorized');
          return true;
        }
        analytics.track('email_unauthorized');
        console.error('Failed to init email link after Google auth', e);
        return false;
      }
    ),
};
