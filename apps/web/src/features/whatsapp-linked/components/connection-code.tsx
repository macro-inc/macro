import QRCode from 'qrcode';
import { createEffect, onCleanup } from 'solid-js';
/** QR encoding stays local; the value never reaches an image URL or third party. */
export function ConnectionCode(props: { value: string }) {
  let canvas: HTMLCanvasElement | undefined;
  createEffect(() => {
    const value = props.value;
    if (canvas)
      void QRCode.toCanvas(canvas, value, {
        width: 224,
        margin: 2,
        errorCorrectionLevel: 'M',
      });
  });
  onCleanup(() => {
    if (canvas)
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  });
  return (
    <canvas
      ref={canvas}
      aria-label="Scan this code with WhatsApp on your phone"
      role="img"
      class="mx-auto max-w-full rounded-md"
    />
  );
}
