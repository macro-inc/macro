import { createSoupState } from '@app/component/next-soup/create-soup-state';
import type { SoupState } from '@app/component/next-soup/create-soup-state';
import {
  filteredSandboxEntities,
  removeSandboxEntity,
  setSidebarFilter,
  sidebarFilter,
} from '../sandbox/sandbox-store';
import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { OnboardingEntityList } from '../OnboardingEntityList';
import { HotkeyCallout } from '../components-lib';
import type { LessonContentProps, LessonDefinition } from '../types';
import { useListNavigation } from '../use-list-navigation';
import { MockAppChrome } from '../components/MockAppChrome';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';

const [sharedSoup, setSharedSoup] = createSignal<SoupState | undefined>();
const [removingIds, setRemovingIds] = createSignal<Set<string>>(new Set());

const REMOVE_ANIMATION_MS = 180;

function NavigateListContent(props: LessonContentProps) {
  const previousFilter = sidebarFilter();
  setSidebarFilter('mail');

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

  // Auto-select the first item as soon as the list has data (handles the case
  // where the filter starts as 'empty' and only populates after a sidebar click).
  let focusInitialized = false;
  createEffect(() => {
    const data = soup.data();
    if (!focusInitialized && data.length > 0) {
      focusInitialized = true;
      untrack(() => soup.navigate.toFirst());
    }
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
        const currentIndex = soup.focus.index();
        const data = soup.items.data();

        // Select the next item by id *before* removing so focus never resets
        const nextItem = data[currentIndex + 1] ?? data[currentIndex - 1];
        if (nextItem) soup.focus.set(nextItem.id);

        // Animate the row away, then remove from the store
        setRemovingIds(new Set<string>([focused.id]));
        setTimeout(() => {
          removeSandboxEntity(focused.id);
          setRemovingIds(new Set<string>());
        }, REMOVE_ANIMATION_MS);

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
    setRemovingIds(new Set<string>());
    setSidebarFilter(previousFilter);
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
            <OnboardingEntityList soup={soup()} removingIds={removingIds} />
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
