import {
  activePlaceableIdSignal,
  newPlaceableSignal,
} from '@block-pdf/signal/placeables';
import { blockElementSignal } from '@core/signal/blockElement';
import Dialog from '@corvu/dialog';
import Check from '@icon/regular/check.svg';
import Trash from '@icon/regular/trash-simple.svg';
import { createCallback } from '@solid-primitives/rootless';
import { Button, cn } from '@ui';
import SignaturePad from 'signature_pad';
import {
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { themeReactive } from '../../../theme/signals/themeReactive';
import { useDeletePlaceable, useModifyPayload } from '../../store/placeables';
import { type AllowableEdits, PayloadMode } from '../../type/placeables';

interface SignatureProps {
  id: string;
  base64: string | null;
  isActive: boolean;
  allowableEdits: AllowableEdits;
  isNew: boolean;
}

interface SignatureEditorProps {
  id: string;
}

function SignatureEditor(props: SignatureEditorProps) {
  let canvasRef!: HTMLCanvasElement;
  let signaturePad: SignaturePad | undefined;

  onMount(() => {
    signaturePad = new SignaturePad(canvasRef);
  });

  const setActivePlaceable = activePlaceableIdSignal.set;
  const modifyPayload = useModifyPayload();
  const deletePlaceable = useDeletePlaceable();

  const setNewPlaceable = newPlaceableSignal.set;
  const updatePlaceable = createCallback((e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setNewPlaceable((prev) =>
      prev?.internalId === props.id ? undefined : prev
    );
    setActivePlaceable(undefined);

    if (!signaturePad?.isEmpty()) {
      modifyPayload(props.id, PayloadMode.Signature, {
        base64: signaturePad?.toDataURL(),
      });
    }
  });

  // ensure no empty signature boxes after signature modal is closed
  onCleanup(() => {
    if (signaturePad && !signaturePad.isEmpty()) return;
    deletePlaceable(props.id);
  });

  // Anchor the editor to the center of the active block rather than the
  // viewport, so the signature canvas appears over the PDF block it belongs to
  // (which may not be the only thing on screen).
  const [blockRect, setBlockRect] = createSignal<DOMRect | undefined>(
    undefined
  );

  onMount(() => {
    const el = blockElementSignal.get();
    if (!el) {
      setBlockRect(undefined);
      return;
    }
    setBlockRect(el.getBoundingClientRect());

    const observer = new ResizeObserver(() => {
      setBlockRect(el.getBoundingClientRect());
    });
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });

  const positionStyle = createMemo<JSX.CSSProperties>(() => {
    const rect = blockRect();
    if (rect) {
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      return {
        position: 'absolute',
        top: `${centerY}px`,
        left: `${centerX}px`,
        transform: 'translate(-50%, -50%)',
      };
    }
    return {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    };
  });

  return (
    <Dialog
      open={true}
      restoreFocus={false}
      // prevents the dialog from immediately being dismissed
      closeOnOutsidePointerStrategy="pointerdown"
      closeOnOutsideFocus={false}
      // this prevents the pointer events helper from getting stuck on dismissed
      // this is because we often prevent default onMouseDown
      noOutsidePointerEvents={false}
    >
      <Portal mount={document.getElementById('modal') ?? undefined}>
        <Dialog.Overlay
          class="flex sm:max-h-full items-center justify-content z-modal-overlay fixed inset-0 bg-modal-overlay"
          style={{
            'max-height': `calc(100dvh - env(safe-area-inset-top, 0px))`,
          }}
        />
        <Dialog.Content
          class={cn(
            'absolute z-modal min-w-[calc(100vw-2rem)]',
            '@sm:min-w-96 p-3',
            'bg-dialog shadow',
            'rounded-lg border border-edge',
            'flex-col justify-start inline-flex gap-3',
            'duration-slow',
            'data-open:animate-in',
            'data-open:fade-in-0 data-open:zoom-in-95',
            'data-closed:animate-out',
            'data-closed:fade-out-0 data-closed:zoom-out-95'
          )}
          style={positionStyle()}
        >
          <canvas
            width={400}
            height={100}
            ref={canvasRef}
            // SCUFFED THEMING TODO: this filter is janky af, checks if it's a "darkish" or "lightish" theme, we should handle this better
            style={{
              filter: themeReactive.b0.l[0]() < 0.5 ? 'invert(1)' : 'none',
            }}
          />
          <div class="flex flex-row w-full justify-center items-center border-t border-edge">
            <Button
              variant="ghost"
              size="icon-md"
              onClick={(e: MouseEvent | KeyboardEvent) =>
                updatePlaceable(e as MouseEvent)
              }
            >
              <Check />
            </Button>
            <Button
              variant="ghost"
              size="icon-md"
              onClick={() => {
                deletePlaceable(props.id);
              }}
            >
              <Trash />
            </Button>
          </div>
        </Dialog.Content>
      </Portal>
    </Dialog>
  );
}

export function Signature(props: SignatureProps) {
  return (
    <div
      class="size-full bg-transparent"
      style={{ outline: props.isActive ? `1px dotted grey` : 'none' }}
    >
      <Show when={props.base64}>
        {(base64) => (
          <img
            class="size-full"
            alt="signature"
            draggable={false}
            src={base64()}
          />
        )}
      </Show>
      <Show when={props.isNew}>
        <SignatureEditor id={props.id} />
      </Show>
    </div>
  );
}
