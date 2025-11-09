import {
  activePlaceableIdSignal,
  newPlaceableSignal,
} from '@block-pdf/signal/placeables';
import { IconButton } from '@core/component/IconButton';
import { Content, Modal, Overlay } from '@core/component/Modal';
import Check from '@icon/regular/check.svg';
import Trash from '@icon/regular/trash-simple.svg';
import { createCallback } from '@solid-primitives/rootless';
import SignaturePad from 'signature_pad';
import { onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { themeReactive } from '../../../block-theme/signals/themeReactive';
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

  return (
    <Modal open={true} restoreFocus={false}>
      <Portal mount={document.getElementById('modal') ?? undefined}>
        <Overlay />
        <Content>
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
            <IconButton
              icon={Check}
              theme="clear"
              onClick={(e: MouseEvent | KeyboardEvent) =>
                updatePlaceable(e as MouseEvent)
              }
            />
            <IconButton
              icon={Trash}
              theme="clear"
              onClick={() => {
                deletePlaceable(props.id);
              }}
            />
          </div>
        </Content>
      </Portal>
    </Modal>
  );
}

export function Signature(props: SignatureProps) {
  return (
    <div
      class="w-full h-full bg-transparent"
      style={{ outline: props.isActive ? `1px dotted grey` : 'none' }}
    >
      <Show when={props.base64}>
        {(base64) => (
          <img
            class="w-full h-full"
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
