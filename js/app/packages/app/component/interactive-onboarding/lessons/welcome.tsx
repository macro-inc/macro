import { onMount } from 'solid-js';
import { A } from '@solidjs/router';
import type { LessonContentProps, LessonDefinition } from '../types';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useAnalytics } from '@app/component/analytics-context';

function WelcomeContent(props: LessonContentProps) {
  onMount(() => props.onComplete('Get Started'));

  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>
        Macro is a unified system for work{'\u2060'}—built for{' '}
        <strong>speed</strong> and <strong>focus</strong>.
        {!isTouchDevice() &&
          ' This short walk-through will introduce a few core features.'}
      </p>
    </div>
  );
}

function WelcomeSecondaryAction() {
  const analytics = useAnalytics();

  return (
    <>
      <p class="text-sm text-ink-extra-muted mt-10">Already have an account?</p>
      <A
        href="/login"
        onClick={() => analytics.track('login_from_onboarding')}
        class="w-full px-3 py-2.5 text-lg rounded-xs flex items-center justify-between gap-2 border-none bg-transparent text-ink-extra-muted hover:bg-hover ring-1 ring-edge-muted"
      >
        Login
      </A>
    </>
  );
}

export const welcomeLesson: LessonDefinition = {
  id: 'welcome',
  title: 'Welcome to Macro',
  content: WelcomeContent,
  secondaryAction: WelcomeSecondaryAction,
  order: 0,
};
