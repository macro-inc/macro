import { t } from '@app/lib/i18n';
import { Button } from '@ui';
import { createSignal, onMount } from 'solid-js';

const STROKE_WIDTH = 2.5;
const INK = '#14213d';

/**
 * A canvas the signer draws their signature on. Reports the drawing as a PNG
 * data URL after each stroke, and `undefined` once cleared.
 */
export function SignaturePad(props: {
  onChange: (dataUrl: string | undefined) => void;
}) {
  let canvas!: HTMLCanvasElement;
  let drawing = false;
  const [empty, setEmpty] = createSignal(true);

  // Keep the backing bitmap at the CSS size times the device pixel ratio so
  // strokes stay sharp and land under the pointer.
  function fitToDisplay() {
    const ratio = window.devicePixelRatio || 1;
    const bounds = canvas.getBoundingClientRect();
    canvas.width = Math.round(bounds.width * ratio);
    canvas.height = Math.round(bounds.height * ratio);

    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineWidth = STROKE_WIDTH;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = INK;
  }
  onMount(fitToDisplay);

  function point(event: PointerEvent) {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function start(event: PointerEvent) {
    const context = canvas.getContext('2d');
    if (!context) return;
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    const { x, y } = point(event);
    context.beginPath();
    context.moveTo(x, y);
  }

  function move(event: PointerEvent) {
    if (!drawing) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const { x, y } = point(event);
    context.lineTo(x, y);
    context.stroke();
  }

  function end() {
    if (!drawing) return;
    drawing = false;
    setEmpty(false);
    props.onChange(canvas.toDataURL('image/png'));
  }

  function clear() {
    fitToDisplay();
    setEmpty(true);
    props.onChange(undefined);
  }

  return (
    <div class="flex flex-col gap-2">
      <canvas
        ref={canvas}
        role="img"
        aria-label={t('contracts.drawSignatureArea')}
        class="h-36 w-full touch-none rounded-xl border border-edge bg-[#ffffff]"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-ink-muted">{t('contracts.drawHint')}</span>
        <Button variant="ghost" size="sm" disabled={empty()} onClick={clear}>
          {t('contracts.clear')}
        </Button>
      </div>
    </div>
  );
}
