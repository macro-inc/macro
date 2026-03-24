import { createSoupState } from '@app/component/next-soup/create-soup-state';
import type { SoupState } from '@app/component/next-soup/create-soup-state';
import {
  filteredSandboxEntities,
  removeSandboxEntity,
} from '../sandbox/sandbox-store';
import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { OnboardingEntityList } from '../OnboardingEntityList';
import { HotkeyCallout } from '../components-lib';
import type { LessonContentProps, LessonDefinition } from '../types';
import { useListNavigation } from '../use-list-navigation';
import { MockAppChrome } from '../components/MockAppChrome';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';

const [sharedSoup, setSharedSoup] = createSignal<SoupState | undefined>();

function NavigateListContent(props: LessonContentProps) {
  const soup = createSoupState({
    initialData: filteredSandboxEntities(),
    wrapNavigation: true,
  });

  setSharedSoup(soup);

  createEffect(() => {
    soup.setData(filteredSandboxEntities());
  });

  const [hasHitNext, setHasHitNext] = createSignal(false);
  const [hasHitPrev, setHasHitPrev] = createSignal(false);
  const [hasMarkedDone, setHasMarkedDone] = createSignal(false);

  const hasNavigated = () => hasHitNext() && hasHitPrev();

  useListNavigation(soup, props.scopeId, (direction) => {
    if (direction === 'down') setHasHitNext(true);
    if (direction === 'up') setHasHitPrev(true);
  });

  const group = createHotkeyGroup();

  onMount(() => {
    registerHotkey({
      scopeId: props.scopeId,
      hotkey: 'e',
      description: 'Mark done',
      keyDownHandler: () => {
        if (!hasNavigated()) return false;
        const focused = soup.focus.item();
        if (!focused) return false;
        removeSandboxEntity(focused.id);
        soup.navigate.down();
        if (!hasMarkedDone()) {
          setHasMarkedDone(true);
          props.onComplete();
        }
        return true;
      },
    }).withGroup(group);
  });

  onCleanup(() => {
    group.dispose();
    setSharedSoup(undefined);
  });

  return (
    <div class="flex flex-col gap-4 onboarding-stagger">
      <p>
        Macro uses fast, familiar keys for navigating lists.{' '}
        <strong class="text-ink/90 font-medium">J</strong> and{' '}
        <strong class="text-ink/90 font-medium">K</strong> — or the arrow keys —
        move you through items without reaching for the mouse.
      </p>

      <div class="flex flex-col gap-2">
        <HotkeyCallout
          keys={['J', '↓']}
          separator="or"
          label="Move to next item"
          completed={hasHitNext()}
        />
        <HotkeyCallout
          keys={['K', '↑']}
          separator="or"
          label="Move back up"
          completed={hasHitPrev()}
        />
      </div>

      <Show when={hasNavigated()}>
        <p>
          In certain views, you can mark items as done to indicate their
          completeness — keeping your list focused on what still needs
          attention.
        </p>
        <HotkeyCallout
          keys={['E']}
          label="Mark item done"
          completed={hasMarkedDone()}
        />
      </Show>
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
