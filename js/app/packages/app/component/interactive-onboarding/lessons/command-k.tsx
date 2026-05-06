import { CommandMenuInner, CommandState } from '@app/component/command';
import type { CategoryFilter } from '@app/component/command';
import { createSoupState } from '@app/component/next-soup/create-soup-state';
import { Panel } from '@ui';
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
import { ClickCallout, HotkeyCallout } from '../components-lib';
import { MockAppChrome } from '../components/MockAppChrome';
import { AnimatedCommandIcon } from '@macro-icons/wide/animating/command';
import { IS_MAC } from '@core/constant/isMac';
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
        The Command Menu allows you to search for documents, tasks, channels,
        and more — and navigate to them instantly.
      </p>
      <div class="mt-2">
        <HotkeyCallout
          keys={[IS_MAC ? '⌘' : 'Ctrl', 'K']}
          separator="+"
          label=""
          completed={completed()}
        />
      </div>
      <div class="flex items-center gap-3 text-sm text-ink/40">
        <div class="h-px w-8 bg-edge-muted" />
        or
        <div class="h-px flex-1 bg-edge-muted" />
      </div>
      <ClickCallout
        icon={AnimatedCommandIcon}
        label="in the sidebar (bottom)"
        completed={completed()}
      />
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

  const soup = createSoupState({ wrapNavigation: true });

  createEffect(() => {
    soup.setRows(filteredSandboxEntities().map((e) => soup.buildRow(e)));
  });

  return (
    <>
      {/* Entity list visible behind the modal */}
      <MockAppChrome
        onCommandClick={() => setCommandKOpen((v) => !v)}
        highlightCommand
      >
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
              <Panel active>
                <div class="*:max-h-[75vh]" ref={setCommandMenuRef}>
                  <CommandMenuInner
                    commandMenuRef={commandMenuRef}
                    items={filteredItems}
                    onSelect={() => {
                      setCompleted(true);
                      props.onComplete();
                    }}
                  />
                </div>
              </Panel>
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
  order: 45,
};
