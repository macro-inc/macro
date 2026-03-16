import { createSoupState } from '@app/component/next-soup/create-soup-state';
import type { SoupState } from '@app/component/next-soup/create-soup-state';
import {
  createHotkeyGroup,
  registerHotkey,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { sandboxEntities } from '../sandbox/sandbox-store';
import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { OnboardingEntityList } from '../OnboardingEntityList';
import { HotkeyCallout } from '../components-lib';
import type { LessonContentProps, LessonDefinition } from '../types';

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

  let containerRef: HTMLDivElement | undefined;
  const [attachHotkeys, scopeId] = useHotkeyDOMScope('onboarding-navigate');

  const group = createHotkeyGroup();

  onMount(() => {
    if (containerRef) {
      attachHotkeys(containerRef);
      containerRef.focus();
    }

    const handleNav = (direction: 'down' | 'up') => {
      soup.navigate[direction]();
      setNavCount((c) => {
        const next = c + 1;
        if (next >= REQUIRED_NAVIGATIONS && !completed()) {
          setCompleted(true);
          props.onComplete();
        }
        return next;
      });
      return true;
    };

    registerHotkey({
      scopeId,
      hotkey: ['j', 'arrowdown'],
      description: 'Navigate down',
      keyDownHandler: () => handleNav('down'),
    }).withGroup(group);

    registerHotkey({
      scopeId,
      hotkey: ['k', 'arrowup'],
      description: 'Navigate up',
      keyDownHandler: () => handleNav('up'),
    }).withGroup(group);
  });

  onCleanup(() => {
    group.dispose();
    setSharedSoup(undefined);
  });

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      class="flex flex-col gap-3 outline-none"
    >
      <HotkeyCallout keys={['J', 'K']} label="or arrow keys to navigate" />
      <HotkeyCallout keys={['↑', '↓']} label="also work" />
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
  title: 'Macro is built around fast list navigation',
  description: 'Use [J, K] or [Up, Down] to navigate this list.',
  content: NavigateListContent,
  demo: NavigateListDemo,
  order: 0.5,
};
