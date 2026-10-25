import { ScopedPortal } from '@core/component/ScopedPortal';
import Dialog from '@corvu/dialog';
import Check from '@phosphor/check.svg';
import Trash from '@phosphor/trash-simple.svg';
import { Button, cn } from '@ui';
import SignaturePad from 'signature_pad';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { resolvedThemeColors } from '../../../theme/signals/themeSignals';
import { usePdfDocument } from '../../context/pdf-document-context';
import { usePdfViewer } from '../../context/pdf-viewer-context';
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
  const pdf = usePdfDocument();
  const rootElement = usePdfViewer().rootElement;
  let canvasRef!: HTMLCanvasElement;
  let signaturePad: SignaturePad | undefined;
  let finished = false;
  const [hasStrokes, setHasStrokes] = createSignal(false);

  onMount(() => {
    const pad = new SignaturePad(canvasRef);
    signaturePad = pad;
    let previousWidth = 0;
    const resizeCanvas = () => {
      const width = canvasRef.offsetWidth;
      const height = canvasRef.offsetHeight;
      if (!width || !height) return;
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const data = pad.toData();
      const scale = previousWidth ? width / previousWidth : 1;
      // SignaturePad uses CSS coordinates; its backing bitmap must match them.
      canvasRef.width = Math.round(width * ratio);
      canvasRef.height = Math.round(height * ratio);
      canvasRef.getContext('2d')?.scale(ratio, ratio);
      pad.clear();
      pad.fromData(
        data.map((group) => ({
          ...group,
          points: group.points.map((point) => ({
            ...point,
            x: point.x * scale,
            y: point.y * scale,
          })),
        }))
      );
      previousWidth = width;
    };
    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(canvasRef);
    const onEndStroke = () => setHasStrokes(!pad.isEmpty());
    pad.addEventListener('endStroke', onEndStroke);
    onCleanup(() => {
      observer.disconnect();
      pad.removeEventListener('endStroke', onEndStroke);
      pad.off();
    });
  });

  const modifyPayload = useModifyPayload();
  const deletePlaceable = useDeletePlaceable();

  const cancel = () => {
    if (finished) return;
    finished = true;
    deletePlaceable(props.id);
    pdf.markup.commands.clearDraftIf(props.id);
  };

  const updatePlaceable = (e: MouseEvent | KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!signaturePad || signaturePad.isEmpty()) return;

    finished = true;
    const updated = modifyPayload(props.id, PayloadMode.Signature, {
      base64: signaturePad.toDataURL(),
    });
    if (!updated) {
      finished = false;
      return;
    }
    pdf.markup.commands.clearDraftIf(props.id);
    pdf.markup.commands.clearActiveIf(props.id);
  };

  // Discard unfinished drafts when the editor or its PDF is dismissed.
  onCleanup(cancel);

  // Anchor the editor to the center of the active block rather than the
  // viewport, so the signature canvas appears over the PDF block it belongs to
  // (which may not be the only thing on screen).
  const [blockRect, setBlockRect] = createSignal<DOMRect>();

  onMount(() => {
    const el = rootElement();
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

  const positionStyle = (): JSX.CSSProperties => {
    const rect = blockRect();
    if (rect) {
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      return {
        position: 'fixed',
        top: `${centerY}px`,
        left: `${centerX}px`,
        translate: '-50% -50%',
        'max-width': `min(calc(100vw - 2rem), calc(${rect.width}px - 2rem))`,
      };
    }
    return {
      position: 'fixed',
      top: '50%',
      left: '50%',
      translate: '-50% -50%',
    };
  };

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
      restoreFocus={false}
      // prevents the dialog from immediately being dismissed
      closeOnOutsidePointerStrategy="pointerdown"
      closeOnOutsideFocus={false}
      // this prevents the pointer events helper from getting stuck on dismissed
      // this is because we often prevent default onMouseDown
      noOutsidePointerEvents={false}
    >
      <ScopedPortal scope={pdf.portalScope()}>
        <Dialog.Overlay
          class="dialog-overlay-open-animation flex sm:max-h-full items-center justify-center z-modal-overlay fixed inset-0 bg-modal-overlay"
          style={{
            'max-height': `calc(100dvh - env(safe-area-inset-top, 0px))`,
          }}
        />
        <Dialog.Content
          class={cn(
            'fixed z-modal w-[426px] max-w-[calc(100vw-2rem)] p-3',
            'elevated-surface',
            'flex-col justify-start inline-flex gap-3',
            'dialog-content-open-animation'
          )}
          style={positionStyle()}
        >
          <Dialog.Label class="sr-only">Draw signature</Dialog.Label>
          <canvas
            aria-label="Signature drawing area"
            class="block w-full aspect-[4/1]"
            width={400}
            height={100}
            ref={canvasRef}
            // SCUFFED THEMING TODO: this filter is janky af, checks if it's a "darkish" or "lightish" theme, we should handle this better
            style={{
              height: 'auto',
              filter:
                resolvedThemeColors()['surface-0'].l < 0.5
                  ? 'invert(1)'
                  : 'none',
            }}
          />
          <div class="flex flex-row w-full justify-center items-center border-t border-edge">
            <Button
              variant="ghost"
              size="icon-md"
              label="Use signature"
              disabled={!hasStrokes()}
              onClick={updatePlaceable}
            >
              <Check />
            </Button>
            <Button
              variant="ghost"
              size="icon-md"
              label="Cancel signature"
              onClick={cancel}
            >
              <Trash />
            </Button>
          </div>
        </Dialog.Content>
      </ScopedPortal>
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
