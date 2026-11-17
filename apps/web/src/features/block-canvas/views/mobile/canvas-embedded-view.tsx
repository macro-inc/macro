import { Button } from '@ui/components/Button';
import { createSignal, onCleanup, Show } from 'solid-js';
import {
  CanvasReadOnlyParts,
  type CanvasReadOnlyViewProps,
  useCanvasReadOnlyView,
} from '../shared/canvas-read-only-parts';

function MobileCanvasEmbeddedLayout() {
  const view = useCanvasReadOnlyView();
  const [interacting, setInteracting] = createSignal(false);

  // A press anywhere else in the document hands the gestures back to it.
  const pressedElsewhere = (event: PointerEvent) => {
    const host = view.host();
    if (host && event.target instanceof Node && !host.contains(event.target))
      end();
  };
  const start = () => {
    // One finger moves the canvas while it has the gestures.
    view.chooseTool('pan');
    setInteracting(true);
    window.addEventListener('pointerdown', pressedElsewhere, true);
  };
  const end = () => {
    setInteracting(false);
    window.removeEventListener('pointerdown', pressedElsewhere, true);
  };
  onCleanup(end);

  return (
    <>
      <CanvasReadOnlyParts.Surface yieldToPage={() => !interacting()} />
      <CanvasReadOnlyParts.Presentation />
      <div class="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end gap-2 p-2">
        <Show
          when={interacting()}
          fallback={
            <Button
              variant="secondary"
              finish="raised"
              size="lg"
              class="pointer-events-auto h-11"
              onClick={start}
            >
              Interact
            </Button>
          }
        >
          <Button
            variant="secondary"
            finish="raised"
            size="lg"
            class="pointer-events-auto h-11"
            onClick={view.fit}
          >
            Zoom to fit
          </Button>
          <Button
            variant="primary"
            size="lg"
            class="pointer-events-auto h-11"
            onClick={end}
          >
            Done
          </Button>
        </Show>
      </div>
    </>
  );
}

/**
 * A canvas inside a document on a phone or tablet. One finger over it scrolls
 * the document, as it does over everything else in the document, and two
 * fingers move the canvas. **Interact** gives the canvas every gesture, so one
 * finger moves it too, until **Done** or a press elsewhere in the document.
 */
export function MobileCanvasEmbeddedView(props: CanvasReadOnlyViewProps) {
  return (
    <CanvasReadOnlyParts.Root {...props}>
      <MobileCanvasEmbeddedLayout />
    </CanvasReadOnlyParts.Root>
  );
}
