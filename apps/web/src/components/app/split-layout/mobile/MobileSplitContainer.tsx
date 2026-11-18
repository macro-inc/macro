import type { PaneId } from '@app/lib/split-router';
import { PaneHiddenContext } from '@core/context/pane-visibility';
import { useAndroidBackNavigation } from '@core/mobile/androidBack';
import {
  type Accessor,
  createComputed,
  createMemo,
  createSignal,
  For,
  Show,
  Suspense,
} from 'solid-js';
import { runSplitBack } from '../back-interceptor';
import { SplitPanel } from '../components/SplitPanel';
import {
  paneOf,
  type SplitHandle,
  type SplitId,
  type SplitManager,
  splitOf,
} from '../layoutManager';
import type { MobilePaneStack } from './createMobilePaneStack';
import { createMobileSplitMotion } from './createMobileSplitMotion';

export type MobileSplitContainerProps = {
  splitManager: Pick<SplitManager, 'getSplit' | 'splitState'>;
  stack: MobilePaneStack;
  /** Panes kept mounted off screen (parked dock views). */
  parkedPanes: Accessor<readonly PaneId[]>;
  panelRefs: Map<SplitId, HTMLDivElement>;
};

/**
 * The mounted panes: the front pane, the one behind it, and any parked ones.
 * A pane keeps its place in the document while it changes role, so going
 * forward, back, or to a parked pane never moves or remounts it.
 */
function createMountedPanes(
  stack: MobilePaneStack,
  parked: Accessor<readonly PaneId[]>
): Accessor<readonly SplitId[]> {
  const [mounted, setMounted] = createSignal<readonly SplitId[]>([]);

  createComputed(() => {
    const shown = [stack.behind(), stack.front()].filter(
      (id): id is SplitId => id !== undefined
    );
    const wanted = [...shown, ...parked().map(splitOf)];

    setMounted((current) => {
      const kept = current.filter((id) => wanted.includes(id));
      const added = wanted.filter((id) => !kept.includes(id));
      return [...kept, ...added];
    });
  });

  return mounted;
}

export function MobileSplitContainer(props: MobileSplitContainerProps) {
  const { splitManager, stack } = props;

  useAndroidBackNavigation(() =>
    runSplitBack({
      canGoBack: stack.canGoBack,
      goBack: stack.goBack,
    })
  );

  const motion = createMobileSplitMotion({ stack });
  const mounted = createMountedPanes(stack, props.parkedPanes);

  const paneFor = (id: SplitId) =>
    createMemo(() => {
      const split = splitManager.splitState(id);
      const rawHandle = splitManager.getSplit(id);
      if (!split || !rawHandle) return undefined;
      const handle: SplitHandle = {
        ...rawHandle,
        goBack: () => stack.goBack(),
        canGoBack: () => stack.canGoBack(),
      };
      return { split, handle };
    });

  return (
    <div
      class="relative size-full overflow-hidden"
      on:touchstart={motion.handleTouchStart}
      on:touchmove={motion.handleTouchMove}
      on:touchend={motion.handleTouchEnd}
      on:touchcancel={motion.handleTouchCancel}
    >
      <For each={mounted()}>
        {(id, index) => {
          const pane = paneFor(id);
          const isFront = () => stack.front() === id;
          const isPresented = () => motion.presentedFront() === id;
          const isParked = () => props.parkedPanes().includes(paneOf(id));

          return (
            <Show when={pane()}>
              {(current) => (
                <div
                  // A parked pane stays mounted but skips rendering.
                  class={
                    isParked()
                      ? 'absolute inset-0 z-0 pointer-events-none invisible [content-visibility:hidden]'
                      : motion.classFor(isFront())
                  }
                  style={isParked() ? undefined : motion.styleFor(isFront())}
                  data-parked-pane={isParked() ? '' : undefined}
                  // Only the presented pane is interactive, so focus (including
                  // programmatic autofocus in late-mounting content) can never
                  // land elsewhere. Demoting a pane also blurs any focused child.
                  inert={!isPresented()}
                  onTransitionEnd={(e) =>
                    motion.handleTransitionEnd(e, isFront())
                  }
                >
                  <PaneHiddenContext.Provider value={isParked}>
                    <Suspense>
                      <SplitPanel
                        split={current().split}
                        handle={current().handle}
                        active={isPresented()}
                        setPanelRef={(ref) => props.panelRefs.set(id, ref)}
                        index={index()}
                      />
                    </Suspense>
                  </PaneHiddenContext.Provider>
                </div>
              )}
            </Show>
          );
        }}
      </For>
    </div>
  );
}
