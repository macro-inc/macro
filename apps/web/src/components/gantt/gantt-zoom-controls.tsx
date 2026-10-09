import MinusIcon from '@phosphor/minus.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Button, cn } from '@ui';
import { useGantt } from './gantt-context';
import { ganttPixelsPerDay } from './gantt-date';
import {
  MAX_GANTT_PIXELS_PER_DAY,
  MIN_GANTT_PIXELS_PER_DAY,
} from './gantt-interaction';

/** Compose beside Gantt.Chart so the controls stay fixed while the calendar scrolls. */
export function GanttZoomControls() {
  const gantt = useGantt();
  const baseline = ganttPixelsPerDay('week');
  const percentage = () => Math.round((gantt.pixelsPerDay() / baseline) * 100);
  const unavailable = () => !gantt.viewport() || gantt.editing();
  const canZoomOut = () =>
    !unavailable() && gantt.pixelsPerDay() > MIN_GANTT_PIXELS_PER_DAY;
  const canZoomIn = () =>
    !unavailable() && gantt.pixelsPerDay() < MAX_GANTT_PIXELS_PER_DAY;

  function zoomTo(pixels: number) {
    const viewport = gantt.viewport();
    if (!viewport || unavailable()) return;
    const bounds = viewport.getBoundingClientRect();
    const center =
      bounds.left +
      gantt.labelWidth() +
      (viewport.clientWidth - gantt.labelWidth()) / 2;
    gantt.zoomAt(center, 300 * Math.log(gantt.pixelsPerDay() / pixels));
  }

  return (
    <div
      class="pointer-events-none absolute bottom-3 right-3 z-40 flex justify-end"
      style={{ left: `${gantt.labelWidth() + 12}px` }}
    >
      <div
        role="group"
        aria-label="Timeline zoom"
        class="group/zoom pointer-events-none flex min-w-0 max-w-full flex-wrap items-center justify-center gap-2 hover:pointer-events-auto focus-within:pointer-events-auto"
      >
        <div class="flex shrink-0 items-center gap-1">
          <Button
            depth={2}
            size="icon-lg"
            variant="ghost"
            label="Zoom out"
            tooltipDisabled={!canZoomOut()}
            class={cn(
              'invisible border-edge-muted bg-surface opacity-0 shadow-md transition-opacity group-hover/zoom:visible group-hover/zoom:pointer-events-auto group-hover/zoom:opacity-100 group-focus-within/zoom:visible group-focus-within/zoom:pointer-events-auto group-focus-within/zoom:opacity-100 touch:visible touch:pointer-events-auto touch:opacity-100 motion-reduce:transition-none',
              gantt.scrollZooming() && 'visible pointer-events-auto opacity-100'
            )}
            disabled={!canZoomOut()}
            onClick={() => zoomTo(gantt.pixelsPerDay() / 1.25)}
          >
            <MinusIcon class="size-5" />
          </Button>
          <Button
            depth={2}
            size="icon-lg"
            variant="ghost"
            label="Zoom in"
            tooltipDisabled={!canZoomIn()}
            class={cn(
              'invisible border-edge-muted bg-surface opacity-0 shadow-md transition-opacity group-hover/zoom:visible group-hover/zoom:pointer-events-auto group-hover/zoom:opacity-100 group-focus-within/zoom:visible group-focus-within/zoom:pointer-events-auto group-focus-within/zoom:opacity-100 touch:visible touch:pointer-events-auto touch:opacity-100 motion-reduce:transition-none',
              gantt.scrollZooming() && 'visible pointer-events-auto opacity-100'
            )}
            disabled={!canZoomIn()}
            onClick={() => zoomTo(gantt.pixelsPerDay() * 1.25)}
          >
            <PlusIcon class="size-5" />
          </Button>
        </div>
        <Button
          depth={2}
          size="lg"
          variant="ghost"
          label="Reset zoom"
          tooltip="Reset zoom to 100%"
          disabled={unavailable()}
          class="pointer-events-auto w-16 shrink-0 border-edge-muted bg-surface px-2 text-sm shadow-md tabular-nums"
          onClick={() => zoomTo(baseline)}
        >
          <span class="truncate">{percentage()}%</span>
        </Button>
      </div>
    </div>
  );
}
