import { CommandMenuInner, CommandState } from '@app/component/command';
import type { CategoryFilter } from '@app/component/command';
import { createSoupState } from '@app/component/next-soup/create-soup-state';
import { ClippedPanel } from '@core/component/ClippedPanel';
import { createFreshSearch } from '@core/util/freshSort';
import { Dialog } from '@kobalte/core/dialog';
import {
  filteredSandboxEntities,
  sandboxToCommandItems,
} from '../sandbox/sandbox-store';
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { Hotkey } from '@core/component/Hotkey';
import { HotkeyCallout } from '../components-lib';
import { MockAppChrome } from '../components/MockAppChrome';
import { OnboardingEntityList } from '../OnboardingEntityList';
import type { LessonContentProps, LessonDefinition } from '../types';

/** Module-level signal toggled by the onboarding shell's cmd+k handler. */
export const [commandKOpen, setCommandKOpen] = createSignal(false);

/** Shared completion state between content and demo panels. */
const [completed, setCompleted] = createSignal(false);

/** Map category filter to the bucket values used by sandbox items. */
const CATEGORY_TO_BUCKETS: Record<CategoryFilter, string[] | null> = {
  all: null, // no filter
  channels: ['channel'],
  dms: ['dm'],
  documents: ['note', 'document'],
  tasks: ['task'],
  chats: ['chat'],
  projects: ['project'],
  commands: [], // sandbox has no commands — show nothing
  people: [], // sandbox has no people — show nothing
};

function CommandKContent(_props: LessonContentProps) {
  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>
        The Command Menu is another way to quickly find items in your workspace.
        Search for documents, tasks, channels, and more — and navigate to them
        instantly.
      </p>
      <HotkeyCallout
        keys={['⌘', 'K']}
        label="to open the command menu"
        completed={completed()}
      />
      <p class="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-fg-muted">
        <strong>Tip:</strong> Search and use
        <span class="flex border border-edge-muted text-[0.625rem] rounded-xs items-center px-1.5 py-0.25 font-normal">
          <Hotkey shortcut="ctrl+j" class="space-x-1" />
        </span>
        /
        <span class="flex border border-edge-muted text-[0.625rem] rounded-xs items-center px-1.5 py-0.25 font-normal">
          <Hotkey shortcut="ctrl+k" class="space-x-1" />
        </span>
        or
        <span class="flex border border-edge-muted text-[0.625rem] rounded-xs items-center px-1.5 py-0.25 font-normal">
          <Hotkey shortcut="arrowup" class="space-x-1" />
        </span>
        /
        <span class="flex border border-edge-muted text-[0.625rem] rounded-xs items-center px-1.5 py-0.25 font-normal">
          <Hotkey shortcut="arrowdown" class="space-x-1" />
        </span>
        to move the cursor.
      </p>
    </div>
  );
}

function CommandKDemo(props: LessonContentProps) {
  const [commandMenuRef, setCommandMenuRef] = createSignal<HTMLDivElement>();

  const [hasOpened, setHasOpened] = createSignal(false);

  onMount(() => {
    CommandState.forceReset();
  });

  // Complete the lesson the first time the command menu closes after being opened.
  createEffect(() => {
    const open = commandKOpen();
    if (open) {
      setHasOpened(true);
    } else if (hasOpened() && !completed()) {
      setCompleted(true);
      props.onComplete();
    }
  });

  onCleanup(() => {
    CommandState.forceReset();
    setCommandKOpen(false);
    setCompleted(false);
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

  let contentEl: HTMLDivElement | undefined;

  const soup = createSoupState({
    initialData: filteredSandboxEntities(),
    wrapNavigation: true,
  });

  createEffect(() => {
    soup.setData(filteredSandboxEntities());
  });

  return (
    <>
      {/* Entity list visible behind the modal */}
      <MockAppChrome>
        <OnboardingEntityList soup={soup} />
      </MockAppChrome>

      <Dialog open={commandKOpen()} onOpenChange={setCommandKOpen}>
        <Dialog.Portal>
          <Dialog.Overlay class="z-modal fixed inset-0 bg-modal-overlay pattern-edge-muted pattern-diagonal-4" />
          <div class="z-modal fixed inset-0 flex items-start justify-center pt-[15vh]">
            <Dialog.Content
              ref={contentEl}
              class="max-w-[calc(100vw-16px)] overflow-hidden portal-scope"
              style={{ width: '800px' }}
            >
              <ClippedPanel active cornerRadius="4px">
                <div class="[&>*]:max-h-[75vh]" ref={setCommandMenuRef}>
                  <CommandMenuInner
                    commandMenuRef={commandMenuRef}
                    items={filteredItems}
                    onSelect={() => {
                      setCompleted(true);
                      props.onComplete();
                    }}
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
