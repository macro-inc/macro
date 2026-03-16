import { createSoupState } from '@app/component/next-soup/create-soup-state';
import type { SoupState } from '@app/component/next-soup/create-soup-state';
import { sandboxEntities } from '../sandbox/sandbox-store';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { OnboardingEntityList } from '../OnboardingEntityList';
import { HotkeyCallout } from '../components-lib';
import type { LessonContentProps, LessonDefinition } from '../types';
import { useListNavigation } from '../use-list-navigation';

const REQUIRED_NAVIGATIONS = 3;

// Module-level signal so the content (left panel) and demo (right panel)
// can share the same soup state without needing a wrapping Context provider.
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

  const [navCount, setNavCount] = createSignal(0);
  const [completed, setCompleted] = createSignal(false);

  useListNavigation(soup, props.scopeId, () => {
    setNavCount((c) => {
      const next = c + 1;
      if (next >= REQUIRED_NAVIGATIONS && !completed()) {
        setCompleted(true);
        props.onComplete();
      }
      return next;
    });
  });

  onCleanup(() => {
    setSharedSoup(undefined);
  });

  return (
    <div class="flex flex-col gap-3">
      <HotkeyCallout
        keys={['J', '↓']}
        separator="or"
        label="Move to next item"
      />
      <HotkeyCallout keys={['K', '↑']} separator="or" label="Move back up" />
      <p class="text-xs text-ink/50">
        <Show
          when={!completed()}
          fallback={<span class="text-accent">Complete!</span>}
        >
          {navCount()}/{REQUIRED_NAVIGATIONS} navigations
        </Show>
      </p>
    </div>
  );
}

function NavigateListDemo() {
  return (
    <Show when={sharedSoup()}>
      {(soup) => (
        <div class="h-full overflow-y-auto">
          <OnboardingEntityList soup={soup()} />
        </div>
      )}
    </Show>
  );
}

export const navigateListLesson: LessonDefinition = {
  id: 'navigate-list',
  title: 'The List',
  content: NavigateListContent,
  demo: NavigateListDemo,
  order: 0.5,
  skippable: true,
};
