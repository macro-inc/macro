import { createSoupState } from '@app/component/next-soup/create-soup-state';
import { sandboxEntities } from '../sandbox/sandbox-store';
import { onMount } from 'solid-js';
import { OnboardingEntityList } from '../OnboardingEntityList';
import { MockAppChrome } from '../components/MockAppChrome';
import type { LessonContentProps, LessonDefinition } from '../types';

function HomeContent(props: LessonContentProps) {
  onMount(() => setTimeout(() => props.onComplete('Got it')));

  return (
    <div class="flex flex-col gap-3">
      <p
        class="text-sm text-ink/70"
        style={{ animation: 'onboarding-fade-up 300ms ease-out 50ms both' }}
      >
        This is your workspace. The sidebar on the left gives you quick access
        to all your views.
      </p>
      <p
        class="text-sm text-ink/70"
        style={{ animation: 'onboarding-fade-up 300ms ease-out 150ms both' }}
      >
        Your content appears in the main area on the right.
      </p>
    </div>
  );
}

function HomeDemo() {
  const soup = createSoupState({
    initialData: sandboxEntities(),
    wrapNavigation: true,
  });

  return (
    <MockAppChrome viewTitle="Documents">
      <OnboardingEntityList soup={soup} />
    </MockAppChrome>
  );
}

export const homeLesson: LessonDefinition = {
  id: 'home',
  title: 'Home',
  content: HomeContent,
  demo: HomeDemo,
  order: 1,
};
