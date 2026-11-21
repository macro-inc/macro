import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { Button } from '@ui/components/Button';
import { createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  CanvasReadOnlyParts,
  type CanvasReadOnlyViewProps,
  useCanvasReadOnlyView,
} from '../shared/canvas-read-only-parts';

/**
 * The controls of a canvas that has the gestures, at the bottom of the screen
 * rather than of the canvas: an embed can be taller than the screen, and one
 * finger no longer scrolls to where its own corner is. They take the slot
 * above the dock, or the bottom of the page where the app has no chrome.
 */
function InteractingBar(props: {
  ref: (element: HTMLElement) => void;
  children: JSX.Element;
}) {
  return (
    <Show
      when={FloatRegions.mount('accessory')}
      fallback={
        <Portal>
          <div
            ref={props.ref}
            class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-end gap-2 px-(--mobile-chrome-gutter) pb-[calc(var(--safe-bottom,0px)+var(--mobile-chrome-gutter))]"
          >
            {props.children}
          </div>
        </Portal>
      }
    >
      <FloatRegion region="accessory">
        <div
          ref={props.ref}
          class="flex justify-end gap-2 px-(--mobile-chrome-gutter)"
        >
          {props.children}
        </div>
      </FloatRegion>
    </Show>
  );
}

function MobileCanvasEmbeddedLayout() {
  const view = useCanvasReadOnlyView();
  const [interacting, setInteracting] = createSignal(false);
  let bar: HTMLElement | undefined;

  // A press anywhere else in the document hands the gestures back to it.
  const pressedElsewhere = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (view.host()?.contains(target) || bar?.contains(target)) return;
    end();
  };
  const start = () => {
    // One finger moves the canvas while it has the gestures.
    view.chooseTool('pan');
    setInteracting(true);
    window.addEventListener('pointerdown', pressedElsewhere, true);
  };
  const end = () => {
    if (interacting()) view.chooseTool('select');
    setInteracting(false);
    window.removeEventListener('pointerdown', pressedElsewhere, true);
  };
  onCleanup(() =>
    window.removeEventListener('pointerdown', pressedElsewhere, true)
  );

  return (
    <>
      <CanvasReadOnlyParts.Surface yieldToPage={() => !interacting()} />
      <CanvasReadOnlyParts.Presentation />
      <Show
        when={interacting()}
        fallback={
          <div class="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end p-2">
            <Button
              variant="secondary"
              finish="raised"
              size="lg"
              class="pointer-events-auto h-11"
              onClick={start}
            >
              Interact
            </Button>
          </div>
        }
      >
        <InteractingBar
          ref={(element) => {
            bar = element;
          }}
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
        </InteractingBar>
      </Show>
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
