import { CommandMenuInner, CommandState } from '@app/component/command';
import type { CategoryFilter } from '@app/component/command';
import { createSoupState } from '@app/component/next-soup/create-soup-state';
import { ClippedPanel } from '@core/component/ClippedPanel';
import { createFreshSearch } from '@core/util/freshSort';
import { Dialog } from '@kobalte/core/dialog';
import {
  sandboxEntities,
  sandboxToCommandItems,
} from '../sandbox/sandbox-store';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
} from 'solid-js';
import { HotkeyCallout } from '../components-lib';
import { MockAppChrome } from '../components/MockAppChrome';
import { OnboardingEntityList } from '../OnboardingEntityList';
import type { LessonContentProps, LessonDefinition } from '../types';

/** Module-level signal toggled by the onboarding shell's cmd+k handler. */
export const [commandKOpen, setCommandKOpen] = createSignal(false);

/** Map category filter to the bucket values used by sandbox items. */
const CATEGORY_TO_BUCKETS: Record<CategoryFilter, string[] | null> = {
  all: null, // no filter
  channels: ['channel'],
  dms: ['dm'],
  notes: ['note'],
  tasks: ['task'],
  documents: ['document'],
  chats: ['chat'],
  projects: ['project'],
  commands: [], // sandbox has no commands — show nothing
  people: [], // sandbox has no people — show nothing
};

function CommandKContent(props: LessonContentProps) {
  const [completed, setCompleted] = createSignal(false);

  // Complete as soon as the user opens the command menu
  createEffect(
    on(commandKOpen, (open) => {
      if (open && !completed()) {
        setCompleted(true);
        props.onComplete();
      }
    })
  );

  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <HotkeyCallout keys={['⌘', 'K']} label="to open the command menu" />
      <p>
        Search for anything — documents, emails, tasks, channels — and navigate
        to it instantly.
      </p>
      <p>
        Press <strong>⌘K</strong> to try it out.
      </p>
    </div>
  );
}

function CommandKDemo(_props: LessonContentProps) {
  const [commandMenuRef, setCommandMenuRef] = createSignal<HTMLDivElement>();

  onMount(() => {
    CommandState.forceReset();
  });

  onCleanup(() => {
    CommandState.forceReset();
    setCommandKOpen(false);
  });

  const allItems = () => sandboxToCommandItems();

  const search = createMemo(() => {
    const q = CommandState.query();
    const hasQuery = q.trim().length > 0;
    return createFreshSearch({
      config: {
        useViewedAt: true,
        fuzzyWeight: hasQuery ? 0.7 : 0.0,
        timeWeight: hasQuery ? 0.3 : 0.9,
        minFuzzyThreshold: hasQuery ? 0.1 : 0,
      },
      getName: (item: ReturnType<typeof sandboxToCommandItems>[number]) =>
        item.searchText,
      getTimestamp: (item: ReturnType<typeof sandboxToCommandItems>[number]) =>
        item.timestamps,
    });
  });

  const filteredItems = createMemo(() => {
    let items = allItems();

    // Filter by category
    const category = CommandState.categoryFilter();
    const allowedBuckets = CATEGORY_TO_BUCKETS[category];
    if (allowedBuckets !== null) {
      items = items.filter((item) => allowedBuckets.includes(item.bucket));
    }

    // Filter by query
    const q = CommandState.query();
    if (q.trim()) {
      return search()(items, q).map((result) => result.item);
    }

    return items;
  });

  // Capture the initial height on first render so the top offset stays fixed
  // even as the list shrinks from filtering.
  const [topOffset, setTopOffset] = createSignal<number | undefined>(undefined);
  let contentEl: HTMLDivElement | undefined;

  const measureOnce = () => {
    if (topOffset() !== undefined || !contentEl) return;
    // Wait a frame for the menu to fully render
    requestAnimationFrame(() => {
      if (!contentEl) return;
      const h = contentEl.getBoundingClientRect().height;
      setTopOffset(Math.max(0, (window.innerHeight - h) / 2));
    });
  };

  // Re-measure each time the dialog opens
  createEffect(() => {
    if (commandKOpen()) {
      setTopOffset(undefined);
      requestAnimationFrame(measureOnce);
    }
  });

  const soup = createSoupState({
    initialData: sandboxEntities(),
    wrapNavigation: true,
  });

  createEffect(() => {
    soup.setData(sandboxEntities());
  });

  return (
    <>
      {/* Entity list visible behind the modal */}
      <MockAppChrome viewTitle="Documents">
        <OnboardingEntityList soup={soup} />
      </MockAppChrome>

      <Dialog open={commandKOpen()} onOpenChange={setCommandKOpen}>
        <Dialog.Portal>
          <Dialog.Overlay class="z-modal fixed inset-0 bg-modal-overlay pattern-edge-muted pattern-diagonal-4" />
          <div class="z-modal fixed inset-0 flex items-start justify-center">
            <Dialog.Content
              ref={contentEl}
              class="max-w-[calc(100vw-16px)] overflow-hidden portal-scope"
              style={{
                width: '800px',
                'margin-top':
                  topOffset() !== undefined ? `${topOffset()}px` : '20vh',
              }}
            >
              <ClippedPanel active cornerRadius="4px">
                <div class="[&>*]:max-h-[75vh]" ref={setCommandMenuRef}>
                  <CommandMenuInner
                    commandMenuRef={commandMenuRef}
                    items={filteredItems}
                  />
                </div>
              </ClippedPanel>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog>
    </>
  );
}

export const commandKLesson: LessonDefinition = {
  id: 'command-k',
  title: 'Command Menu',
  content: CommandKContent,
  demo: CommandKDemo,
  skippable: true,
  order: 40,
};
