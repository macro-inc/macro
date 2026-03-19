import { createSoupState } from '@app/component/next-soup/create-soup-state';
import { sandboxEntities } from '../sandbox/sandbox-store';
import { onMount } from 'solid-js';
import { OnboardingEntityList } from '../OnboardingEntityList';
import { MockAppChrome } from '../components/MockAppChrome';
import type { LessonContentProps, LessonDefinition } from '../types';

function HomeContent(props: LessonContentProps) {
  onMount(() => setTimeout(() => props.onComplete('Got it')));

  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>
        The Macro workspace has a the left-hand <strong>Sidebar</strong>
        and <strong>Splits</strong> which can contain{' '}
        <strong>List Views</strong> or content.
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
  title: 'Workspace',
  content: HomeContent,
  demo: HomeDemo,
  order: 1,
};
