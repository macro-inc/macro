import { createSoupState } from '@app/component/next-soup/create-soup-state';
import {
  filteredSandboxEntities,
  sidebarFilter,
} from '../sandbox/sandbox-store';
import { createEffect, createSignal } from 'solid-js';
import { OnboardingEntityList } from '../OnboardingEntityList';
import { HotkeyCallout } from '../components-lib';
import { MockAppChrome } from '../components/MockAppChrome';
import type { LessonContentProps, LessonDefinition } from '../types';

function SidebarNavContent(props: LessonContentProps) {
  const [done, setDone] = createSignal(false);
  createEffect(() => {
    if (sidebarFilter() === 'mail') {
      setDone(true);
      props.onComplete();
    }
  });

  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>
        Use the sidebar to quickly jump between views. Try navigating to{' '}
        <strong>Emails</strong>.
      </p>
      <HotkeyCallout
        keys={['G', 'E']}
        separator="then"
        label="Go to Emails"
        completed={done()}
      />
      <p class="text-sm text-ink/50">
        Or click the email icon in the sidebar on the right.
      </p>
    </div>
  );
}

function SidebarNavDemo() {
  const soup = createSoupState({
    initialData: filteredSandboxEntities(),
    wrapNavigation: true,
  });

  createEffect(() => {
    soup.setData(filteredSandboxEntities());
  });

  return (
    <MockAppChrome>
      <OnboardingEntityList soup={soup} />
    </MockAppChrome>
  );
}

export const sidebarNavLesson: LessonDefinition = {
  id: 'sidebar-nav',
  title: 'Sidebar Navigation',
  content: SidebarNavContent,
  demo: SidebarNavDemo,
  order: 5,
  skippable: true,
};
