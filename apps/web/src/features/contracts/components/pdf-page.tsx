import { fireAndForget } from '@core/util/fireAndForget';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { cn } from '@ui';
import { ResultAsync } from 'neverthrow';
import {
  createEffect,
  createSignal,
  type JSX,
  on,
  onCleanup,
  onMount,
} from 'solid-js';
import type { PdfDocument } from '../context/contracts-context';

/** US Letter, used until the page reports its own shape. */
const DEFAULT_ASPECT_RATIO = 612 / 792;
/** Pages within this much of the scroller's height are kept painted. */
const NEAR_MARGIN = '150% 0px';

/**
 * One PDF page painted to fill its width, with children laid over it. The
 * page is white in every theme, as the document will print. Only a page near
 * the viewport holds a bitmap, so a long document costs a few pages of
 * memory; its words are always present as text for assistive technology.
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
  const [near, setNear] = createSignal(false);
  const [text, setText] = createSignal('');

  createResizeObserver(
    () => frame,
    (rect) => setWidth(Math.round(rect.width))
  );

  onMount(() => {
    // Without the observer every page counts as near, as before.
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setNear(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: NEAR_MARGIN }
    );
    observer.observe(frame);
    onCleanup(() => observer.disconnect());
  });

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
    // The page scrolled away while it painted: give the bitmap back.
    if (token !== wanted) release();
  }

  function release() {
    canvas.width = 0;
    canvas.height = 0;
  }

  async function describe(pdf: PdfDocument, page: number) {
    const [ratio, words] = await Promise.all([
      pdf.pageAspectRatio(page),
      pdf.pageText(page),
    ]);
    if (disposed || pdf !== props.pdf || page !== props.page) return;
    setAspectRatio(ratio);
    setText(words);
  }

  createEffect(
    on(
      () => [props.pdf, props.page] as const,
      ([pdf, page]) => fireAndForget(describe(pdf, page), 'contracts.pdf-page')
    )
  );

  createEffect(
    on(
      () => [props.pdf, props.page, width(), near()] as const,
      ([pdf, page, cssWidth, isNear]) => {
        const token = ++wanted;
        if (cssWidth === 0) return;
        if (!isNear) {
          release();
          return;
        }
        const previous = paints;
        paints = (async () => {
          // A paint that failed is reported where it started; the next
          // paint still runs, so a resize or revisit can restore the page.
          await ResultAsync.fromPromise(previous, () => undefined);
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
      <canvas
        ref={canvas}
        aria-hidden="true"
        class="absolute inset-0 size-full"
      />
      <p class="sr-only">{text()}</p>
      {props.children}
    </div>
  );
}
