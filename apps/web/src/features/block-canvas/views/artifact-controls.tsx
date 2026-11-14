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

// Screen pixels between the bar and the artifact's top edge.
const GAP = 8;
// A selected shape's rotation handle: a circle this far above its top edge.
const ROTATION_HANDLE_OFFSET = 16;
const ROTATION_HANDLE_RADIUS = 6;
const ROTATION_HANDLE_CLEARANCE =
  ROTATION_HANDLE_OFFSET + ROTATION_HANDLE_RADIUS + GAP;

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * Each artifact's slide position, Interact and Present, in a bar just above
 * its top-right corner. The bar lives in screen space, so it keeps its size at
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
  const fits = () => (bounds()?.width ?? 0) >= width();

  // A narrow selected artifact's rotation handle, at the middle of its top
  // edge, would sit under the bar; lift the bar above the handle then.
  const offset = () => {
    const box = bounds();
    if (!box || !props.clearRotationHandle) return GAP;

    const barLeft = box.x + box.width - width();
    const handleRight = box.x + box.width / 2 + ROTATION_HANDLE_RADIUS;
    return barLeft < handleRight ? ROTATION_HANDLE_CLEARANCE : GAP;
  };

  return (
    <Show when={bounds()}>
      {(box) => (
        <div
          ref={(element) => observer.observe(element)}
          data-canvas-artifact-controls={props.id}
          data-canvas-embed-active={props.active ? props.id : undefined}
          class={cn(
            'absolute top-0 left-0 z-10 flex items-center gap-1 rounded-full p-1 text-ink',
            isMobile() ? 'island' : 'menu-surface'
          )}
          style={{
            transform: `translate(${box().x + box().width}px, ${box().y - offset()}px) translate(-100%, -100%)`,
            visibility: fits() ? undefined : 'hidden',
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
