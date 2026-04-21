import { createSoupState } from '@app/component/next-soup/create-soup-state';
import {
  filteredSandboxEntities,
  sidebarFilter,
} from '../sandbox/sandbox-store';
import { createEffect, createSignal } from 'solid-js';
import { OnboardingEntityList } from '../OnboardingEntityList';
import { ClickCallout, HotkeyCallout } from '../components-lib';
import { MockAppChrome } from '../components/MockAppChrome';
import { AnimatedEmailIcon } from '@macro-icons/wide/animating/email';
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
      <p>Use the sidebar to quickly jump between views.</p>
      <p>
        Try navigating to <strong>Emails</strong>.
      </p>
      <div class="mt-2">
        <HotkeyCallout
          keys={['G', 'E']}
          separator="then"
          label=""
          completed={done()}
        />
      </div>
      <div class="flex items-center gap-3 text-sm text-ink/40">
        <div class="h-px w-8 bg-edge-muted" />
        or
        <div class="h-px flex-1 bg-edge-muted" />
      </div>
      <ClickCallout
        icon={AnimatedEmailIcon}
        label="in the sidebar"
        completed={done()}
      />
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
    <MockAppChrome highlightId="mail">
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
};
