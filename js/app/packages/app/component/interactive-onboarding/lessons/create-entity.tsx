import { createSoupState } from '@app/component/next-soup/create-soup-state';
import type { SoupState } from '@app/component/next-soup/create-soup-state';
import {
  LauncherInner,
  CREATABLE_BLOCKS,
  type CreatableBlock,
} from '@app/component/Launcher';
import {
  createHotkeyGroup,
  registerHotkey,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { Dialog } from '@kobalte/core/dialog';
import {
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { OnboardingEntityList } from '../OnboardingEntityList';
import type { LessonContentProps, LessonDefinition } from '../types';
import {
  sandboxEntities,
  addSandboxEntity,
  createSandboxEntity,
  type SandboxEntityType,
} from '../sandbox/sandbox-store';

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
const [onCreated, setOnCreated] = createSignal<(() => void) | undefined>();
const [launcherOpen, setLauncherOpen] = createSignal(false);

function CreateEntityContent(props: LessonContentProps) {
  const [createCount, setCreateCount] = createSignal(0);
  const [completed, setCompleted] = createSignal(false);

  setOnCreated(() => () => {
    setCreateCount((c) => c + 1);
    if (!completed()) {
      setCompleted(true);
      props.onComplete();
    }
  });

  let containerRef: HTMLDivElement | undefined;
  const [attachHotkeys, scopeId] = useHotkeyDOMScope('onboarding-create');
  const group = createHotkeyGroup();

  onMount(() => {
    if (containerRef) {
      attachHotkeys(containerRef);
      containerRef.focus();
    }

    registerHotkey({
      scopeId,
      hotkey: 'c',
      description: 'Open Create menu',
      keyDownHandler: () => {
        setLauncherOpen(true);
        return true;
      },
    }).withGroup(group);
  });

  // Return focus to content panel when launcher closes
  createEffect(
    on(launcherOpen, (open, prevOpen) => {
      if (!open && prevOpen) {
        containerRef?.focus();
      }
    })
  );

  onCleanup(() => {
    group.dispose();
    setLauncherOpen(false);
    setOnCreated(undefined);
  });

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      class="flex flex-col gap-3 outline-none"
    >
      <Show
        when={launcherOpen()}
        fallback={
          <p class="text-sm text-ink/70">
            Press{' '}
            <kbd class="px-1.5 py-0.5 rounded bg-hover/50 font-mono text-xs">
              c
            </kbd>{' '}
            to open the Create menu.
          </p>
        }
      >
        <p class="text-sm text-ink/70">
          Choose what to create. Press{' '}
          <kbd class="px-1.5 py-0.5 rounded bg-hover/50 font-mono text-xs">
            esc
          </kbd>{' '}
          to close the menu.
        </p>
      </Show>
      <p class="text-xs text-ink/50">
        <Show
          when={!completed()}
          fallback={
            <span class="text-accent">Complete! Created {createCount()}.</span>
          }
        >
          {createCount()} created — create at least 1 to continue
        </Show>
      </p>
    </div>
  );
}

function CreateEntityDemo() {
  const soup = createSoupState({
    initialData: sandboxEntities(),
    wrapNavigation: true,
  });

  setSharedSoup(soup);

  // Keep soup synced with sandbox store
  createEffect(() => {
    soup.setData(sandboxEntities());
  });

  // Build sandbox versions of all creatable blocks
  const sandboxBlocks: CreatableBlock[] = CREATABLE_BLOCKS.map((block) => ({
    ...block,
    keyDownHandler: () => {
      const sandboxType = BLOCK_TO_SANDBOX[block.blockName];
      if (sandboxType) {
        const entity = createSandboxEntity(sandboxType);
        addSandboxEntity(entity);
        onCreated()?.();
      }
      setLauncherOpen(false);
      return true;
    },
  }));

  onCleanup(() => {
    setSharedSoup(undefined);
  });

  return (
    <div class="flex flex-col h-full relative">
      <div class="flex-1 overflow-y-auto">
        <Show when={sharedSoup()}>
          {(s) => <OnboardingEntityList soup={s()} />}
        </Show>
      </div>

      <Dialog open={launcherOpen()} onOpenChange={setLauncherOpen} modal={true}>
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-modal bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
          <Dialog.Content>
            <div
              class="fixed inset-0 z-modal w-screen h-screen flex items-center justify-center"
              onClick={(e) => {
                if (e.target === e.currentTarget) setLauncherOpen(false);
              }}
            >
              <LauncherInner
                blocks={sandboxBlocks}
                modal
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
  title: 'Create an entity',
  description: 'Use the launcher to create docs, emails, and more.',
  content: CreateEntityContent,
  demo: CreateEntityDemo,
  order: 0.5,
};
