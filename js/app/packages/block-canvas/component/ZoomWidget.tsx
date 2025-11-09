import { ZOOM_TARGETS } from '@block-canvas/constants';
import { withAnalytics } from '@coparse/analytics';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import Tooltip from '@corvu/tooltip';
import Minus from '@icon/regular/minus.svg';
import Plus from '@icon/regular/plus.svg';
import { onMount, Show } from 'solid-js';
import { useToolManager } from '../signal/toolManager';
import { useRenderState } from '../store/RenderState';

const { track, TrackingEvents } = withAnalytics();

const nextInList = (list: number[], current: number, larger = true) => {
  if (larger) {
    if (list.length === 0) return current;
    if (list[0] > current) {
      return list[0];
    }
    for (let i = 0; i < list.length; i++) {
      if (list[i] > current) {
        return list[i];
      }
    }
  }
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[list.length - 1] < current) {
      return list[list.length - 1];
    }
    const val = list[i];
    if (val < current) {
      return val;
    }
  }
};

export function ZoomWidget() {
  let widgetRef!: HTMLDivElement;
  const { currentScale, animateTo } = useRenderState();
  const toolManager = useToolManager();

  const zoomIn = () => {
    const val = nextInList(ZOOM_TARGETS, currentScale(), true);
    animateTo({ scale: val }, 200, true);
  };

  const zoomOut = () => {
    const val = nextInList(ZOOM_TARGETS, currentScale(), false);
    animateTo({ scale: val }, 200, true);
  };

  const zoomPercent = () => {
    return Math.floor(currentScale() * 100);
  };

  const resetZoom = () => {
    animateTo({ scale: 1 }, 200, true);
    track(TrackingEvents.BLOCKCANVAS.RESETZOOM);
  };

  onMount(() => {
    toolManager.ignoreMouseEvents(widgetRef);
  });

  return (
    <div
      class="cursor-auto absolute bottom-4 left-4 rounded-xl flex flex-row items-center gap-1 p-2 w-32 justify-between"
      ref={widgetRef}
    >
      <Show when={!isMobileWidth()}>
        <div
          on:click={zoomOut}
          class="hover:bg-hover hover-transition-bg rounded-lg w-1/4 h-6 flex items-center justify-center pointer-events-auto text-ink-muted"
        >
          <Minus class="size-4" />
        </div>
      </Show>
      <Tooltip placement="top" floatingOptions={{ offset: 12 }}>
        <Tooltip.Anchor>
          <Tooltip.Trigger>
            <div
              class="text-ink-muted text-center w-12 h-6 select-none"
              on:click={resetZoom}
            >
              {zoomPercent()}%
            </div>
          </Tooltip.Trigger>
        </Tooltip.Anchor>
        <Tooltip.Portal>
          <Tooltip.Content>
            <div
              class="flex items-center justify-center 
                      bg-ink p-[6px] text-panel text-sm
                      rounded-md shadow-xs"
            >
              Reset zoom
            </div>
            <Tooltip.Arrow class="text-ink text-xs w-1 h-1" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip>
      <Show when={!isMobileWidth()}>
        <div
          on:click={zoomIn}
          class="hover:bg-hover hover-bg-transition rounded-lg w-1/4 h-6 flex items-center justify-center pointer-events-auto text-ink-muted"
        >
          <Plus class="size-4" />
        </div>
      </Show>
    </div>
  );
}
