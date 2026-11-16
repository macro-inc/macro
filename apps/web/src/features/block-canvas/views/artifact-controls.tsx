import { isMobile } from '@core/mobile/isMobile';
import {
  type Camera,
  enclosing,
  type GraphicsDocument,
  type GraphicsEditor,
  presentationOrder,
  selectionFrame,
  worldToScreen,
} from '@macro-inc/graphics';
import { Button, cn } from '@ui';
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';

// The tab's inset from the artifact's right edge, in screen pixels.
const INSET = 8;
// How far the tab's box runs on under the artifact's top edge. That part is
// clipped away, so the tab ends flat on the edge, as if it peeks out from
// behind the slide, with its rim and shadow cut at the seam.
const TUCK = 16;
// A selected shape's rotation handle sits at the middle of its top edge.
const ROTATION_HANDLE_RADIUS = 6;

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * Each artifact's slide position, Interact and Present, in a tab peeking out
 * from the top edge near its right corner. The bar lives in screen space, so it keeps its size at
 * any zoom, and it hides while a gesture moves or resizes shapes.
 */
export function ArtifactControls(props: {
  editor: GraphicsEditor;
  /** Editable surfaces draw a rotation handle the bar must not cover. */
  editable: boolean;
  activeId: string | undefined;
  onInteract: (id: string) => void;
  onDone: () => void;
  onPresent: (id: string) => void;
}) {
  const [camera, setCamera] = createSignal(props.editor.getCamera());
  const [document, setDocument] = createSignal(props.editor.document);
  const [session, setSession] = createSignal(props.editor.getSession());
  onCleanup(props.editor.subscribeCamera(setCamera));
  onCleanup(props.editor.subscribeDocument(setDocument));
  onCleanup(props.editor.subscribeSession(setSession));

  const order = createMemo(
    () => presentationOrder(document()).map((item) => item.id),
    undefined,
    { equals: sameIds }
  );

  return (
    <Show when={!session().transform}>
      <For each={order()}>
        {(id, index) => (
          <ArtifactControlBar
            id={id}
            document={document()}
            camera={camera()}
            position={index() + 1}
            count={order().length}
            clearRotationHandle={
              props.editable && sameIds(session().selectedIds, [id])
            }
            active={props.activeId === id}
            onInteract={() => props.onInteract(id)}
            onDone={props.onDone}
            onPresent={() => props.onPresent(id)}
          />
        )}
      </For>
    </Show>
  );
}

function ArtifactControlBar(props: {
  id: string;
  document: GraphicsDocument;
  camera: Camera;
  position: number;
  count: number;
  clearRotationHandle: boolean;
  active: boolean;
  onInteract: () => void;
  onDone: () => void;
  onPresent: () => void;
}) {
  const [width, setWidth] = createSignal(0);
  const observer = new ResizeObserver(([entry]) =>
    setWidth(entry?.borderBoxSize[0]?.inlineSize ?? 0)
  );
  onCleanup(() => observer.disconnect());

  // The artifact's screen box; a rotated artifact uses the box around it.
  const bounds = createMemo(() => {
    const frame = selectionFrame(props.document, [props.id]);
    if (!frame) return undefined;
    return enclosing(
      frame.corners.map((point) => worldToScreen(props.camera, point))
    );
  });
  const fits = () => (bounds()?.width ?? 0) >= width() + INSET * 2;

  // On a narrow selected artifact the tab would cover the rotation handle at
  // the middle of the top edge. The tab stays on the edge, so it steps aside
  // (hides) then; the inspector still offers Present. While interacting it
  // stays, since Done lives on it.
  const coversHandle = () => {
    const box = bounds();
    if (!box || !props.clearRotationHandle || props.active) return false;

    const tabLeft = box.x + box.width - INSET - width();
    return tabLeft < box.x + box.width / 2 + ROTATION_HANDLE_RADIUS;
  };

  return (
    <Show when={bounds()}>
      {(box) => (
        <div
          ref={(element) => observer.observe(element)}
          data-canvas-artifact-controls={props.id}
          data-canvas-embed-active={props.active ? props.id : undefined}
          class={cn(
            'absolute top-0 left-0 z-10 flex items-center gap-1 rounded-t-xl p-1 text-ink',
            isMobile() ? 'island' : 'menu-surface'
          )}
          style={{
            'padding-bottom': `${TUCK + 4}px`,
            'clip-path': `inset(-48px -48px ${TUCK}px -48px)`,
            transform: `translate(${box().x + box().width - INSET}px, ${box().y + TUCK}px) translate(-100%, -100%)`,
            visibility: fits() && !coversHandle() ? undefined : 'hidden',
          }}
        >
          <span
            data-canvas-artifact-position
            class="px-1.5 text-xs text-ink-muted tabular-nums whitespace-nowrap"
          >
            {props.position}/{props.count}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => (props.active ? props.onDone() : props.onInteract())}
          >
            {props.active ? 'Done' : 'Interact'}
          </Button>
          <Button variant="secondary" size="sm" onClick={props.onPresent}>
            Present
          </Button>
        </div>
      )}
    </Show>
  );
}
