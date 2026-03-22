import { createSoupState } from '@app/component/next-soup/create-soup-state';
import type { SoupState } from '@app/component/next-soup/create-soup-state';
import { sandboxEntities } from '../sandbox/sandbox-store';
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
    initialData: sandboxEntities(),
    wrapNavigation: true,
  });

  setSharedSoup(soup);

  // Keep soup synced with sandbox store (entities created in earlier lesson)
  createEffect(() => {
    soup.setData(sandboxEntities());
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
    <MockAppChrome viewTitle="Documents">
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
  title: 'The List',
  content: NavigateListContent,
  demo: NavigateListDemo,
  order: 20,
  skippable: true,
};
