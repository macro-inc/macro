import { type Accessor, createMemo, Show, Suspense } from 'solid-js';
import { SplitPanel } from '../components/SplitPanel';
import type {
  SplitHandle,
  SplitId,
  SplitManager,
  SplitState,
} from '../layoutManager';
import { createMobileSplitMotion } from './createMobileSplitMotion';
import type { MobileSwipeLayout } from './createMobileSwipeLayout';

export type MobileSplitContainerProps = {
  splitManager: SplitManager;
  mobileSwipeLayout: MobileSwipeLayout;
  splits: Accessor<ReadonlyArray<SplitState>>;
  panelRefs: Map<SplitId, HTMLDivElement>;
};

export function MobileSplitContainer(props: MobileSplitContainerProps) {
  const { splitManager, mobileSwipeLayout } = props;

  const motion = createMobileSplitMotion({
    mobileSwipeLayout,
  });

  const slotDataFor = (slotSplitId: Accessor<SplitId | undefined>) =>
    createMemo(() => {
      const id = slotSplitId();
      if (!id) return undefined;
      const split = props.splits().find((s) => s.id === id);
      const rawHandle = splitManager.getSplit(id);
      if (!split || !rawHandle) return undefined;
      const handle: SplitHandle = {
        ...rawHandle,
        goBack: () => mobileSwipeLayout.swipeBack(),
        canGoBack: () => mobileSwipeLayout.canGoBack(),
      };
      return { split, handle };
    });

  const slotAData = slotDataFor(mobileSwipeLayout.slotASplitId);
  const slotBData = slotDataFor(mobileSwipeLayout.slotBSplitId);

  const renderKeyForSplit = (split: SplitState) =>
    `${split.id}:${split.content.type}:${split.content.id}`;

  return (
    <div
      class="relative size-full overflow-hidden"
      on:touchstart={motion.handleTouchStart}
      on:touchmove={motion.handleTouchMove}
      on:touchend={motion.handleTouchEnd}
      on:touchcancel={motion.handleTouchCancel}
    >
      <Show when={slotAData()}>
        {(a) => (
          <div
            class={motion.classForSlot(mobileSwipeLayout.fgIsSlotA())}
            style={motion.styleForSlot(mobileSwipeLayout.fgIsSlotA())}
            onTransitionEnd={(e) =>
              motion.handleTransitionEnd(e, mobileSwipeLayout.fgIsSlotA())
            }
          >
            {/*
             * Key by split and content so SplitPanel remounts when a slot
             * receives a new split, even if it has the same content id.
             */}
            <Show when={renderKeyForSplit(a().split)} keyed>
              {(_renderKey) => (
                <Suspense>
                  <SplitPanel
                    split={a().split}
                    handle={a().handle}
                    active={mobileSwipeLayout.fgIsSlotA()}
                    setPanelRef={(ref) =>
                      props.panelRefs.set(a().split.id, ref)
                    }
                    index={0}
                  />
                </Suspense>
              )}
            </Show>
          </div>
        )}
      </Show>

      <Show when={slotBData()}>
        {(b) => (
          <div
            class={motion.classForSlot(!mobileSwipeLayout.fgIsSlotA())}
            style={motion.styleForSlot(!mobileSwipeLayout.fgIsSlotA())}
            onTransitionEnd={(e) =>
              motion.handleTransitionEnd(e, !mobileSwipeLayout.fgIsSlotA())
            }
          >
            <Show when={renderKeyForSplit(b().split)} keyed>
              {(_renderKey) => (
                <Suspense>
                  <SplitPanel
                    split={b().split}
                    handle={b().handle}
                    active={!mobileSwipeLayout.fgIsSlotA()}
                    setPanelRef={(ref) =>
                      props.panelRefs.set(b().split.id, ref)
                    }
                    index={1}
                  />
                </Suspense>
              )}
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
