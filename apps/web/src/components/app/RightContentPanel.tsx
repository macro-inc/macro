import { CommandState } from '@app/features/command/state';
import { globalSplitManager } from '@app/signal/splitLayout';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import { itemToBlockName } from '@core/constant/allBlocks';
import { useUserId } from '@core/context/user';
import type { EntityData } from '@entity';
import ExpandIcon from '@phosphor/arrows-out.svg';
import PlusIcon from '@phosphor/plus.svg';
import PanelIcon from '@phosphor/sidebar-simple.svg';
import CloseIcon from '@phosphor/x.svg';
import { Button } from '@ui';
import { ScrollIndicatorsContext } from '@ui/components/Scroll';
import {
  type Accessor,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  type ParentProps,
  Show,
  Suspense,
} from 'solid-js';
import { useGlobalBlockOrchestrator } from './GlobalAppState';
import { PreviewPanel } from './PreviewPanel';
import { RightPanelContext } from './right-panel-context';
import { RightPanelOwnerContext } from './right-panel-owner';
import { createRightPanelRegistry } from './right-panel-persistence';
import type { createRightPanelState } from './right-panel-state';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';

/** Reference tabs follow the main item and restore when returning to it. */
export function RightContentPanel(props: ParentProps<{ contentKey?: string }>) {
  const panel = useSplitPanelOrThrow();
  const userId = useUserId();
  const registry = createMemo(() => createRightPanelRegistry(userId()));
  const [owner, setOwner] = createSignal<Accessor<string>>();
  const state = createMemo(() => {
    const content = panel.handle.content();
    const base = `${content.type}:${content.id}`;
    return registry().forContent(
      JSON.stringify([base, owner()?.() ?? props.contentKey ?? base])
    );
  });
  const registerOwner = (next: Accessor<string>) => {
    setOwner(() => next);
    return () => {
      if (owner() === next) setOwner(undefined);
    };
  };
  return (
    <RightPanelContext.Provider
      value={{ open: (content) => state().open(content) }}
    >
      <div class="relative flex size-full min-h-0 min-w-0 overflow-hidden @container/reference-panel">
        <div class="flex min-w-0 min-h-0 flex-1 flex-col">
          <RightPanelOwnerContext.Provider value={registerOwner}>
            {props.children}
          </RightPanelOwnerContext.Provider>
        </div>
        <Show when={state()} keyed>
          {(current) => <ReferenceTabs state={current} />}
        </Show>
      </div>
    </RightPanelContext.Provider>
  );
}

function ReferenceTabs(props: {
  state: ReturnType<typeof createRightPanelState>;
}) {
  const state = props.state;
  const id = createUniqueId();
  const [tabsRef, setTabsRef] = createSignal<HTMLDivElement>();
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const addReference = (entity: EntityData) => {
    const type = itemToBlockName(entity);
    if (type) state.open({ type, id: entity.id });
  };
  onCleanup(() => {
    if (CommandState.entityPicker() === addReference) {
      CommandState.clearEntityPicker();
      CommandState.close();
    }
  });
  return (
    <Show when={state.tabs().length > 0}>
      <Show when={!state.expanded()}>
        <Button
          variant="ghost"
          size="icon-sm"
          class="absolute right-4 top-2 z-20"
          label={`Open reference panel (${state.tabs().length} tabs)`}
          onClick={() => state.setExpanded(true)}
        >
          <PanelIcon class="size-4" />
        </Button>
      </Show>
      <aside
        aria-label="Reference panel"
        class="relative flex h-full w-[44%] min-w-80 max-w-[720px] shrink-0 flex-col border-l border-edge-muted bg-panel @max-[800px]/reference-panel:absolute @max-[800px]/reference-panel:inset-y-0 @max-[800px]/reference-panel:right-0 @max-[800px]/reference-panel:w-[min(100%,480px)] @max-[800px]/reference-panel:z-30"
        classList={{ hidden: !state.expanded() }}
      >
        <div class="flex h-12 shrink-0 items-center gap-1 border-b border-edge-muted px-4">
          <div class="relative min-w-0 flex-1">
            <div
              ref={setTabsRef}
              on:keydown={(event) => {
                const buttons = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    '[role="tab"]'
                  ),
                ];
                const index = buttons.indexOf(
                  document.activeElement as HTMLButtonElement
                );
                if (index < 0) return;
                const target =
                  event.key === 'ArrowRight'
                    ? (index + 1) % buttons.length
                    : event.key === 'ArrowLeft'
                      ? (index + buttons.length - 1) % buttons.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? buttons.length - 1
                          : undefined;
                if (target === undefined) return;
                event.preventDefault();
                event.stopPropagation();
                buttons[target].click();
                buttons[target].focus();
              }}
              role="tablist"
              aria-label="Opened references"
              class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
            >
              <For each={state.tabs()}>
                {(tab) => (
                  <div
                    class="flex max-w-52 shrink-0 items-center rounded-lg"
                    classList={{ 'bg-hover': state.active() === tab.key }}
                  >
                    <button
                      id={`${id}-tab-${tab.key}`}
                      aria-controls={`${id}-panel-${tab.key}`}
                      tabIndex={state.active() === tab.key ? 0 : -1}
                      role="tab"
                      aria-selected={state.active() === tab.key}
                      class="min-w-0 truncate px-2 py-2 text-xs"
                      onClick={() => state.select(tab.key)}
                    >
                      {tab.title}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      label={`Close ${tab.title}`}
                      onClick={() => state.close(tab.key)}
                    >
                      <CloseIcon class="size-3" />
                    </Button>
                  </div>
                )}
              </For>
            </div>
            <ScrollIndicators
              scrollRef={tabsRef}
              direction="horizontal"
              appearance="gradient"
              gradientColor="panel"
            />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            label="Add reference tab"
            onClick={() => CommandState.openEntityPicker(addReference)}
          >
            <PlusIcon class="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            label="Open reference full screen"
            onClick={() => {
              const tab = state
                .tabs()
                .find((tab) => tab.key === state.active());
              if (tab) globalSplitManager()?.replaceAllSplits(tab.content);
            }}
          >
            <ExpandIcon class="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            label="Collapse reference panel"
            onClick={() => state.setExpanded(false)}
          >
            <PanelIcon class="size-4" />
          </Button>
        </div>
        <For each={state.tabs().map((tab) => tab.key)}>
          {(key) => {
            const tab = () => state.tabs().find((tab) => tab.key === key)!;
            const context = {
              ...panel,
              handle: {
                ...panel.handle,
                content: () => tab().content,
                close: () => state.close(key),
                displayName: () => tab().title,
                setDisplayName: (title: string) => state.rename(key, title),
              },
            };
            return (
              <div
                id={`${id}-panel-${key}`}
                aria-labelledby={`${id}-tab-${key}`}
                role="tabpanel"
                aria-label={tab().title}
                class="min-h-0 flex-1"
                inert={state.active() !== key || !state.expanded()}
                classList={{ hidden: state.active() !== key }}
              >
                <Suspense
                  fallback={
                    <div class="px-4 py-4 text-sm text-ink-muted">Loading…</div>
                  }
                >
                  <ScrollIndicatorsContext.Provider value={true}>
                    <PreviewPanel
                      content={tab().content}
                      orchestrator={orchestrator}
                      splitPanelContext={context}
                      hideHeader
                    />
                  </ScrollIndicatorsContext.Provider>
                </Suspense>
              </div>
            );
          }}
        </For>
      </aside>
    </Show>
  );
}
