import { fireAndForget } from '@core/util/fireAndForget';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { cn } from '@ui';
import { createEffect, createSignal, type JSX, on, onCleanup } from 'solid-js';
import type { PdfDocument } from '../context/contracts-context';

/** US Letter, used until the page reports its own shape. */
const DEFAULT_ASPECT_RATIO = 612 / 792;

/**
 * One PDF page painted to fill its width, with children laid over it. The
 * page is white in every theme, as the document will print.
 */
export function PdfPage(props: {
  pdf: PdfDocument;
  /** Zero-based page index. */
  page: number;
  class?: string;
  label: string;
  ref?: (element: HTMLDivElement) => void;
  children?: JSX.Element;
}) {
  let frame!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;
  const [width, setWidth] = createSignal(0);
  const [aspectRatio, setAspectRatio] = createSignal(DEFAULT_ASPECT_RATIO);

  createResizeObserver(
    () => frame,
    (rect) => setWidth(Math.round(rect.width))
  );

  // pdf.js refuses two paints on one canvas at once, so paints run in turn
  // and a paint that is no longer wanted is skipped.
  let paints: Promise<void> = Promise.resolve();
  let wanted = 0;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  async function paint(
    token: number,
    pdf: PdfDocument,
    page: number,
    cssWidth: number
  ) {
    if (disposed || token !== wanted) return;
    await pdf.renderPage(page, canvas, cssWidth);
  }

  async function measure(pdf: PdfDocument, page: number) {
    const ratio = await pdf.pageAspectRatio(page);
    if (!disposed && pdf === props.pdf && page === props.page) {
      setAspectRatio(ratio);
    }
  }

  createEffect(
    on(
      () => [props.pdf, props.page] as const,
      ([pdf, page]) => fireAndForget(measure(pdf, page), 'contracts.pdf-page')
    )
  );

  createEffect(
    on(
      () => [props.pdf, props.page, width()] as const,
      ([pdf, page, cssWidth]) => {
        if (cssWidth === 0) return;
        const token = ++wanted;
        const previous = paints;
        paints = (async () => {
          await previous;
          await paint(token, pdf, page, cssWidth);
        })();
        fireAndForget(paints, 'contracts.pdf-page');
      }
    )
  );

  return (
    <div
      ref={(element) => {
        frame = element;
        props.ref?.(element);
      }}
      role="group"
      aria-label={props.label}
      class={cn(
        '@container relative w-full overflow-hidden bg-[#ffffff]',
        props.class
      )}
      style={{
        'aspect-ratio': String(aspectRatio()),
      }}
    >
      <canvas ref={canvas} class="absolute inset-0 size-full" />
      {props.children}
    </div>
  );
}
