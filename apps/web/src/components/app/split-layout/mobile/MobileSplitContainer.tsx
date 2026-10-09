import { ContentLoading } from '@components/app/ContentLoading';
import { useAndroidBackNavigation } from '@core/mobile/androidBack';
import {
  type Accessor,
  createComputed,
  createMemo,
  createSignal,
  Index,
  Show,
  Suspense,
} from 'solid-js';
import { runSplitBack } from '../back-interceptor';
import { SplitPanel } from '../components/SplitPanel';
import type {
  SplitHandle,
  SplitId,
  SplitManager,
  SplitState,
} from '../layoutManager';
import type { MobilePaneStack } from './createMobilePaneStack';
import { createMobileSplitMotion } from './createMobileSplitMotion';

export type MobileSplitContainerProps = {
  splitManager: Pick<SplitManager, 'getSplit'>;
  stack: MobilePaneStack;
  splits: Accessor<ReadonlyArray<SplitState>>;
  panelRefs: Map<SplitId, HTMLDivElement>;
};

type Slots = readonly [SplitId | undefined, SplitId | undefined];

/**
 * Two fixed slots hold the front pane and the one behind it. A pane keeps
 * its slot while it changes role, so going forward or back never moves or
 * remounts it.
 */
function createPaneSlots(stack: MobilePaneStack): Accessor<Slots> {
  const [slots, setSlots] = createSignal<Slots>([undefined, undefined]);

  createComputed(() => {
    const shown = [stack.behind(), stack.front()].filter(
      (id): id is SplitId => id !== undefined
    );

    setSlots(([first, second]) => {
      const keepFirst = first && shown.includes(first) ? first : undefined;
      const keepSecond = second && shown.includes(second) ? second : undefined;
      const free = shown.filter((id) => id !== keepFirst && id !== keepSecond);

      return [keepFirst ?? free.shift(), keepSecond ?? free.shift()];
    });
  });

  return slots;
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
  const slots = createPaneSlots(stack);

  const paneFor = (id: SplitId) =>
    createMemo(() => {
      const split = props.splits().find((s) => s.id === id);
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
      <Index each={slots()}>
        {(slotId, index) => (
          <Show when={slotId()} keyed>
            {(id) => {
              const pane = paneFor(id);
              const isFront = () => stack.front() === id;
              const isPresented = () => motion.presentedFront() === id;

              return (
                <Show when={pane()}>
                  {(current) => (
                    <div
                      class={motion.classFor(isFront())}
                      style={motion.styleFor(isFront())}
                      // Only the presented pane is interactive, so focus (including
                      // programmatic autofocus in late-mounting content) can never
                      // land elsewhere. Demoting a pane also blurs any focused child.
                      inert={!isPresented()}
                      onTransitionEnd={(e) =>
                        motion.handleTransitionEnd(e, isFront())
                      }
                    >
                      <Suspense fallback={<ContentLoading />}>
                        <SplitPanel
                          split={current().split}
                          handle={current().handle}
                          active={isPresented()}
                          setPanelRef={(ref) => props.panelRefs.set(id, ref)}
                          index={index}
                        />
                      </Suspense>
                    </div>
                  )}
                </Show>
              );
            }}
          </Show>
        )}
      </Index>
    </div>
  );
}
