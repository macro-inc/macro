import { createSoupState } from '@app/component/next-soup/create-soup-state';
import type { SoupState } from '@app/component/next-soup/create-soup-state';
import {
  LauncherInner,
  CREATABLE_BLOCKS,
  type CreatableBlock,
} from '@app/component/Launcher';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { Dialog } from '@kobalte/core/dialog';
import {
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { useListNavigation } from '../use-list-navigation';
import { OnboardingEntityList } from '../OnboardingEntityList';
import { MockAppChrome } from '../components/MockAppChrome';
import { HotkeyCallout } from '../components-lib';
import type { LessonContentProps, LessonDefinition } from '../types';
import {
  filteredSandboxEntities,
  addSandboxEntity,
  createSandboxEntity,
  sidebarFilter,
  setSidebarFilter,
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
const [completed, setCompleted] = createSignal(false);

function CreateEntityContent(props: LessonContentProps) {
  setOnCreated(() => () => {
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
        quickly, from anywhere. Press <strong>C</strong> to open the Launcher.
      </p>
      <HotkeyCallout
        keys={['C']}
        label="to open the Create menu"
        completed={completed()}
      />
    </div>
  );
}

function CreateEntityDemo(props: LessonContentProps) {
  const soup = createSoupState({
    initialData: filteredSandboxEntities(),
    wrapNavigation: true,
  });

  setSharedSoup(soup);

  // Ensure we always start in the All Items view
  const previousFilter = sidebarFilter();
  setSidebarFilter(null);

  useListNavigation(soup, props.scopeId);

  // Keep soup synced with sandbox store
  createEffect(() => {
    soup.setData(filteredSandboxEntities());
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
    setSidebarFilter(previousFilter);
  });

  return (
    <div class="flex flex-col h-full relative">
      <MockAppChrome>
        <Show when={sharedSoup()}>
          {(s) => <OnboardingEntityList soup={s()} />}
        </Show>
      </MockAppChrome>

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
  order: 45,
  skippable: true,
};
