import { createSoupState } from '@app/component/next-soup/create-soup-state';
import type { SoupState } from '@app/component/next-soup/create-soup-state';
import { filteredSandboxEntities } from '../sandbox/sandbox-store';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { OnboardingEntityList } from '../OnboardingEntityList';
import { HotkeyCallout } from '../components-lib';
import type { LessonContentProps, LessonDefinition } from '../types';
import { useListNavigation } from '../use-list-navigation';
import { MockAppChrome } from '../components/MockAppChrome';

const REQUIRED_NAVIGATIONS = 3;

const [sharedSoup, setSharedSoup] = createSignal<SoupState | undefined>();

function NavigateListContent(props: LessonContentProps) {
  const soup = createSoupState({
    initialData: filteredSandboxEntities(),
    wrapNavigation: true,
  });

  setSharedSoup(soup);

  // Keep soup synced with sandbox store + active filter
  createEffect(() => {
    soup.setData(filteredSandboxEntities());
  });

  let navCount = 0;

  useListNavigation(soup, props.scopeId, () => {
    navCount++;
    if (navCount >= REQUIRED_NAVIGATIONS) {
      props.onComplete();
    }
  });

  onCleanup(() => {
    setSharedSoup(undefined);
  });

  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <HotkeyCallout
        keys={['J', '↓']}
        separator="or"
        label="Move to next item"
      />
      <HotkeyCallout keys={['K', '↑']} separator="or" label="Move back up" />
    </div>
  );
}

function NavigateListDemo() {
  return (
    <MockAppChrome>
      <Show when={sharedSoup()}>
        {(soup) => (
          <div class="h-full overflow-y-auto">
            <OnboardingEntityList soup={soup()} />
          </div>
        )}
      </Show>
    </MockAppChrome>
  );
}

export const navigateListLesson: LessonDefinition = {
  id: 'navigate-list',
  title: 'The List View',
  content: NavigateListContent,
  demo: NavigateListDemo,
  order: 20,
  skippable: true,
};
