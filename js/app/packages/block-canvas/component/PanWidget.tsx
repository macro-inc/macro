import Tooltip from '@corvu/tooltip';
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
        <Tooltip placement="top" floatingOptions={{ offset: 12 }}>
          <Tooltip.Anchor>
            <Tooltip.Trigger>
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
            </Tooltip.Trigger>
          </Tooltip.Anchor>
          <Tooltip.Portal>
            <Tooltip.Content>
              <div
                class="flex items-center justify-center 
                      bg-ink p-[6px] text-page text-sm
                      rounded-md shadow-xs"
              >
                Reset view
              </div>
              <Tooltip.Arrow class="text-ink text-xs w-1 h-1" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip>
      </div>
    </div>
  );
}
