import { createSoupState } from '@app/component/next-soup/create-soup-state';
import { filteredSandboxEntities } from '../sandbox/sandbox-store';
import { createEffect, onMount } from 'solid-js';
import { OnboardingEntityList } from '../OnboardingEntityList';
import { MockAppChrome } from '../components/MockAppChrome';
import type { LessonContentProps, LessonDefinition } from '../types';

function HomeContent(props: LessonContentProps) {
  onMount(() => setTimeout(() => props.onComplete('Got it')));

  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>
        The Macro workspace has a <strong>Sidebar</strong> and{' '}
        <strong>Splits</strong>. Each split can contain{' '}
        <strong>List Views</strong> or content.
      </p>
      <p class="text-sm text-ink/50">
        Try clicking the sidebar icons on the right to filter the list.
      </p>
    </div>
  );
}

function HomeDemo() {
  const soup = createSoupState({
    initialData: filteredSandboxEntities(),
    wrapNavigation: true,
  });

  createEffect(() => {
    soup.setRows(filteredSandboxEntities().map((e) => soup.buildRow(e)));
  });

  return (
    <MockAppChrome>
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
