import { beginInteraction } from '@app/observability/flow';
import CaretLeft from '@icon/system/regular/caret-left.svg';
import CaretRight from '@icon/system/regular/caret-right.svg';
import X from '@icon/system/regular/x.svg';
import { type GraphicsEditor, presentationOrder } from '@macro-inc/graphics';
import { createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { usePresentation } from '../context/presentation';
import { SlideStage } from './transitions/slide-stage';

/** Full screen, stepping through the canvas's artifacts in presentation order
 * with each slide's transition. */
export function ArtifactPresentation(props: {
  editor: GraphicsEditor;
  startId: string;
  onExit: () => void;
}) {
  let root!: HTMLDivElement;
  const presentation = usePresentation();
  const [document_, setDocument] = createSignal(props.editor.document);
  onCleanup(props.editor.subscribeDocument(setDocument));

  const artifacts = createMemo(() => presentationOrder(document_()));
  const [currentId, setCurrentId] = createSignal(props.startId);
  let lastIndex = 0;
  // A peer can delete or reorder what is on screen. Stay near the same place.
  const index = createMemo(() => {
    const found = artifacts().findIndex((item) => item.id === currentId());
    if (found !== -1) lastIndex = found;
    return found !== -1
      ? found
      : Math.min(lastIndex, Math.max(artifacts().length - 1, 0));
  });
  const current = createMemo(() => artifacts()[index()]);

  const go = (delta: number) => {
    const next = artifacts()[index() + delta];
    if (next) setCurrentId(next.id);
  };
  const handleKey = (key: string) => {
    if (key === 'Escape') props.onExit();
    else if (key === 'ArrowRight' || key === ' ' || key === 'PageDown') go(1);
    else if (key === 'ArrowLeft' || key === 'PageUp') go(-1);
    else return false;

    return true;
  };

  onMount(() => {
    const interaction = beginInteraction('canvas.artifact.present', {
      attributes: {
        'artifact.id': props.startId,
        'artifact.count': artifacts().length,
      },
    });
    root.focus();
    void root.requestFullscreen?.().catch(() => {});
    interaction.end();

    // Capture: no canvas or app shortcut, such as delete, acts behind the show.
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (handleKey(event.key)) event.preventDefault();
    };
    const onFullscreen = () => {
      // Leaving full screen with the browser's own Esc ends the show.
      if (!document.fullscreenElement) props.onExit();
    };
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('fullscreenchange', onFullscreen);
    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('fullscreenchange', onFullscreen);
      if (document.fullscreenElement === root)
        void document.exitFullscreen().catch(() => {});
    });
  });

  return (
    <Portal>
      <div
        ref={root}
        tabIndex={-1}
        role="dialog"
        aria-label="Artifact presentation"
        data-canvas-artifact-presentation
        class="fixed inset-0 z-modal flex flex-col bg-[black] outline-none"
      >
        <div class="min-h-0 flex-1">
          <SlideStage
            document={document_()}
            slides={artifacts()}
            current={current()}
            deckDefault={presentation.deckDefault()}
            interactive
            surface="present"
            onKey={handleKey}
          />
        </div>
        <div class="flex shrink-0 items-center justify-center gap-2 p-2 text-[white] text-xs">
          <button
            type="button"
            aria-label="Previous artifact"
            class="rounded-full p-2 hover:bg-[white]/20 disabled:opacity-40"
            disabled={index() === 0}
            onClick={() => go(-1)}
          >
            <CaretLeft class="size-4" />
          </button>
          <span
            class="tabular-nums"
            data-testid="canvas-artifact-presentation-counter"
          >
            {index() + 1} / {artifacts().length}
          </span>
          <button
            type="button"
            aria-label="Next artifact"
            class="rounded-full p-2 hover:bg-[white]/20 disabled:opacity-40"
            disabled={index() >= artifacts().length - 1}
            onClick={() => go(1)}
          >
            <CaretRight class="size-4" />
          </button>
          <span class="max-w-64 truncate px-2">
            {current()?.geometry.title}
          </span>
          <button
            type="button"
            aria-label="Exit presentation"
            class="rounded-full p-2 hover:bg-[white]/20"
            onClick={props.onExit}
          >
            <X class="size-4" />
          </button>
        </div>
      </div>
    </Portal>
  );
}
