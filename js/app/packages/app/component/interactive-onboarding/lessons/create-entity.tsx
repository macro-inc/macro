import {
  CREATABLE_BLOCKS,
  type CreatableBlock,
  LauncherInner,
} from '@app/component/Launcher';
import {
  createSoupState,
  type SoupState,
} from '@app/component/next-soup/create-soup-state';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { Dialog } from '@kobalte/core/dialog';
import { AnimatedPlusIcon } from '@macro-icons/wide/animating/plus';
import {
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { MockAppChrome } from '../components/MockAppChrome';
import { ClickCallout, HotkeyCallout } from '../components-lib';
import { OnboardingEntityList } from '../OnboardingEntityList';
import {
  addSandboxEntity,
  createSandboxEntity,
  filteredSandboxEntities,
  type SandboxEntityType,
  setSidebarFilter,
  sidebarFilter,
} from '../sandbox/sandbox-store';
import type { LessonContentProps, LessonDefinition } from '../types';
import { useListNavigation } from '../use-list-navigation';

const BLOCK_TO_SANDBOX: Record<string, SandboxEntityType> = {
  md: 'md',
  email: 'email',
  task: 'task',
  channel: 'channel',
  chat: 'chat',
  canvas: 'canvas',
  project: 'project',
  code: 'code',
};

// Module-level signals shared between content (left) and demo (right)
const [sharedSoup, setSharedSoup] = createSignal<SoupState | undefined>();
const [launcherOpen, setLauncherOpenRaw] = createSignal(false);
const [completed, setCompleted] = createSignal(false);
const [onLauncherOpened, setOnLauncherOpened] = createSignal<
  (() => void) | undefined
>();

// Wrap the setter so opening the launcher also fires the lesson-completion
// callback. This replaces a createEffect on launcherOpen — per AGENTS.md,
// prefer wrapping the setter over using an effect to trigger updates.
const setLauncherOpen = (value: boolean | ((prev: boolean) => boolean)) => {
  const next = typeof value === 'function' ? value(launcherOpen()) : value;
  const wasOpen = launcherOpen();
  setLauncherOpenRaw(next);
  if (next && !wasOpen) onLauncherOpened()?.();
};

function CreateEntityContent(props: LessonContentProps) {
  setOnLauncherOpened(() => () => {
    if (!completed()) {
      setCompleted(true);
      props.onComplete();
    }
  });

  let containerRef: HTMLDivElement | undefined;
  const group = createHotkeyGroup();

  onMount(() => {
    registerHotkey({
      scopeId: props.scopeId,
      hotkey: 'c',
      description: 'Open Create menu',
      keyDownHandler: () => {
        setLauncherOpen((open) => !open);
        return true;
      },
    }).withGroup(group);
  });

  // Return focus to content panel when launcher closes, but only while the
  // lesson is still in progress. Once completed, the parent auto-focuses the
  // Continue button — refocusing here would steal it back.
  createEffect(
    on(launcherOpen, (open, prevOpen) => {
      if (!open && prevOpen && !completed()) {
        containerRef?.focus();
      }
    })
  );

  onCleanup(() => {
    group.dispose();
    setLauncherOpen(false);
    setOnLauncherOpened(undefined);
    setCompleted(false);
  });

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      class="flex flex-col gap-3 outline-none onboarding-stagger"
    >
      <p>
        The <strong>Create Launcher</strong> lets you create Macro Editor
        quickly, from anywhere.
      </p>
      <div class="mt-2">
        <HotkeyCallout keys={['C']} label="" completed={completed()} />
      </div>
      <div class="flex items-center gap-3 text-sm text-ink/40">
        <div class="h-px w-8 bg-edge-muted" />
        or
        <div class="h-px flex-1 bg-edge-muted" />
      </div>
      <ClickCallout
        icon={AnimatedPlusIcon}
        label="in the sidebar"
        completed={completed()}
      />
    </div>
  );
}

function CreateEntityDemo(props: LessonContentProps) {
  const soup = createSoupState({
    wrapNavigation: true,
  });

  setSharedSoup(soup);

  // Ensure we always start in the All Items view
  const previousFilter = sidebarFilter();
  setSidebarFilter(null);

  useListNavigation(soup, props.scopeId);

  // Keep soup synced with sandbox store
  createEffect(() => {
    soup.setRows(filteredSandboxEntities().map((e) => soup.buildRow(e)));
  });

  // Build sandbox versions of all creatable blocks
  const sandboxBlocks: CreatableBlock[] = CREATABLE_BLOCKS.map((block) => ({
    ...block,
    keyDownHandler: () => {
      const sandboxType = BLOCK_TO_SANDBOX[block.blockName];
      if (sandboxType) {
        const entity = createSandboxEntity(sandboxType);
        addSandboxEntity(entity);
      }
      setLauncherOpen(false);
      return true;
    },
  }));

  onCleanup(() => {
    setSharedSoup(undefined);
    setSidebarFilter(previousFilter);
  });

  return (
    <div class="flex flex-col h-full relative">
      <MockAppChrome
        onCreateClick={() => setLauncherOpen((v) => !v)}
        highlightCreate
      >
        <Show when={sharedSoup()}>
          {(s) => <OnboardingEntityList soup={s()} />}
        </Show>
      </MockAppChrome>

      <Dialog open={launcherOpen()} onOpenChange={setLauncherOpen} modal={true}>
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-modal bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
          <Dialog.Content
            onCloseAutoFocus={(e) => {
              // Once the lesson is complete, don't let the Dialog restore
              // focus to the element that opened it (containerRef or the `+`
              // button). Re-fire onComplete so the parent schedules focus on
              // the Continue button — otherwise Enter won't advance the step.
              if (completed()) {
                e.preventDefault();
                props.onComplete();
              }
            }}
          >
            <div
              class="fixed inset-0 z-modal w-screen h-screen flex items-center justify-center"
              onClick={(e) => {
                if (e.target === e.currentTarget) setLauncherOpen(false);
              }}
            >
              <LauncherInner
                blocks={sandboxBlocks}
                onClose={() => setLauncherOpen(false)}
              />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </div>
  );
}

export const createEntityLesson: LessonDefinition = {
  id: 'create-entity',
  title: 'Create',
  subtitle: 'Use the launcher to create docs, emails, and more.',
  content: CreateEntityContent,
  demo: CreateEntityDemo,
  order: 40,
};
