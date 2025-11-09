import {
  canTryMindMapAgainSignal,
  currentlyMappingSignal,
  isGeneratingMindMapSignal,
  mindmapContentSignal,
  redoGenerateMindMap,
} from '@block-canvas/signal/generateMindMap';
import LoadingIcon from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import { toast } from 'core/component/Toast/Toast';
import { createEffect, createMemo, on, Show } from 'solid-js';
import { renderMermaid } from './CanvasController';

export function LoadingMindMap() {
  createEffect(
    on(isGeneratingMindMapSignal, (isGenerating, prev) => {
      if (prev === undefined) return;
      if (isGenerating) return;

      const mindmapContent = mindmapContentSignal();
      if (!mindmapContent) {
        const canTryMindMapAgain = canTryMindMapAgainSignal[0];
        if (canTryMindMapAgain()) {
          redoGenerateMindMap();
        } else {
          toast.failure('Failed to generate Mind Map.');
        }
        return;
      }
      renderMermaid({ code: mindmapContent });
    })
  );

  const documentName = createMemo(() => {
    return 'the content';
  });

  return (
    <Show when={isGeneratingMindMapSignal()}>
      <div class="absolute w-full h-full ">
        <div class="absolute w-full h-full pointer-events-none bg-panel/80" />
        <div class="relative w-full h-full flex items-center justify-center">
          <div class="w-fit max-w-[60%] h-fit py-2 px-4 rounded-xl flex flex-center items-center justify-center bg-panel/90 border-1 border-edge">
            <LoadingIcon class="flex mr-2 w-10 h-10 animate-spin text-canvas" />
            <p class="text-xl font-medium text-ink truncate">
              {currentlyMappingSignal()
                ? currentlyMappingSignal()
                : `Reading through ${documentName()}`}
            </p>
          </div>
        </div>
      </div>
    </Show>
  );
}
