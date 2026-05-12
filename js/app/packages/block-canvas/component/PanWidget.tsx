import { Tooltip } from '@ui';
import { onMount } from 'solid-js';
import { useToolManager } from '../signal/toolManager';
import { useRenderState } from '../store/RenderState';

export function PanWidget() {
  let widgetRef!: HTMLDivElement;
  const toolManager = useToolManager();
  const { currentPosition, pan } = useRenderState();

  onMount(() => {
    toolManager.ignoreMouseEvents(widgetRef);
  });

  return (
    <div class="cursor-auto absolute bottom-4 right-4 flex flex-row items-center h-10">
      <div class="rounded-xl gap-1 p-2 min-w-24 text-center" ref={widgetRef}>
        <Tooltip placement="top" label="Reset view">
          <div
            class="text-ink-muted w-full select-none"
            on:mousedown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              pan(-currentPosition().x, -currentPosition().y);
            }}
            on:touchstart={(e) => {
              e.preventDefault();
              e.stopPropagation();
              pan(-currentPosition().x, -currentPosition().y);
            }}
          >
            {'(' +
              Math.round(-currentPosition().x) +
              ', ' +
              Math.round(currentPosition().y) +
              ')'}
          </div>
        </Tooltip>
      </div>
    </div>
  );
}
