/**
 * Print and Save as PDF (PowerPoint's Print pane): full page slides, notes
 * pages, or handouts, for all slides, the current one, or a range. Pages
 * are composed from slide renders on canvases, then printed through the
 * browser or written to a PDF.
 */

import type { DeckOutline } from '@core/pptx-engine/types';
import FilePdf from '@phosphor/file-pdf.svg';
import Printer from '@phosphor/printer.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { createSignal, For, Show } from 'solid-js';
import type { PresentationEngine } from '../context/pptx-editor-context';
import { buildImagePdf, type PdfPage } from '../core/pdf';
import {
  defaultPaper,
  type PageSpec,
  type Paper,
  type PrintLayout,
  pageSpec,
  paginate,
  parseSlideRange,
  slidesPerPage,
} from '../core/print-layout';

/** Composed pages are drawn at this resolution. */
const DPI = 150;

const LAYOUTS: { id: PrintLayout; label: string }[] = [
  { id: 'slides', label: 'Full page slides' },
  { id: 'notes', label: 'Notes pages' },
  { id: 'handouts3', label: 'Handouts (3 slides per page)' },
  { id: 'handouts6', label: 'Handouts (6 slides per page)' },
];

/** Wraps text to `width` pixels, keeping paragraph breaks. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.replaceAll('\u000b', '\n').split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** Draws one page: its slides, notes, ruled lines, and page number. */
async function composePage(
  engine: PresentationEngine,
  deck: DeckOutline,
  spec: PageSpec,
  layout: PrintLayout,
  indexes: number[],
  pageNumber: number,
  frame: boolean
): Promise<HTMLCanvasElement> {
  const k = DPI / 72;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(spec.width * k);
  canvas.height = Math.round(spec.height * k);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [n, index] of indexes.entries()) {
    const r = spec.slides[n];
    const bitmap = await engine.render(index, Math.round(r.w * k));
    ctx.drawImage(bitmap, r.x * k, r.y * k, r.w * k, r.h * k);
    bitmap.close();
    if (frame || layout !== 'slides') {
      ctx.strokeStyle = '#7f7f7f';
      ctx.lineWidth = Math.max(1, 0.75 * k);
      ctx.strokeRect(r.x * k, r.y * k, r.w * k, r.h * k);
    }
    const lines = spec.lines?.[n];
    if (lines) {
      ctx.strokeStyle = '#a6a6a6';
      ctx.lineWidth = Math.max(1, 0.5 * k);
      const count = 6;
      for (let i = 1; i <= count; i++) {
        const y = (lines.y + (lines.h * i) / (count + 1)) * k;
        ctx.beginPath();
        ctx.moveTo(lines.x * k, y);
        ctx.lineTo((lines.x + lines.w) * k, y);
        ctx.stroke();
      }
    }
  }
  if (spec.notes) {
    const notes = deck.slides[indexes[0]]?.notes ?? '';
    const size = 12 * k;
    ctx.fillStyle = '#000000';
    ctx.font = `${size}px Calibri, Carlito, Arial, sans-serif`;
    ctx.textBaseline = 'top';
    const box = spec.notes;
    let y = box.y * k;
    for (const line of wrap(ctx, notes, box.w * k)) {
      if (y + size > (box.y + box.h) * k) break;
      ctx.fillText(line, box.x * k, y);
      y += size * 1.25;
    }
  }
  if (spec.footer) {
    ctx.fillStyle = '#595959';
    ctx.font = `${9 * k}px Calibri, Carlito, Arial, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    const f = spec.footer;
    ctx.fillText(String(pageNumber), (f.x + f.w) * k, f.y * k);
  }
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode a page.'))),
      type,
      quality
    )
  );

/** Prints page images through a hidden frame and the browser's dialog. */
async function printImages(urls: string[], spec: PageSpec) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.dataset.testid = 'pptx-print-frame';
  Object.assign(frame.style, {
    position: 'fixed',
    width: '0',
    height: '0',
    border: '0',
    right: '0',
    bottom: '0',
  });
  document.body.append(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) throw new Error('Printing is unavailable.');
  const style = doc.createElement('style');
  style.textContent = `@page { size: ${spec.width}pt ${spec.height}pt; margin: 0 }
html, body { margin: 0; padding: 0 }
img { display: block; width: ${spec.width}pt; height: ${spec.height}pt; break-after: page }
img:last-child { break-after: auto }`;
  doc.head.append(style);
  await Promise.all(
    urls.map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = doc.createElement('img');
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = src;
          doc.body.append(img);
        })
    )
  );
  const cleanup = () => {
    frame.remove();
    for (const url of urls) URL.revokeObjectURL(url);
  };
  win.addEventListener('afterprint', () => setTimeout(cleanup, 0), {
    once: true,
  });
  win.focus();
  win.print();
  // Some browsers print without `afterprint`; clean up eventually.
  setTimeout(cleanup, 60_000);
}

export function PrintDialog(props: {
  engine: PresentationEngine;
  deck: DeckOutline;
  current: number;
  fileName: string;
  download: (bytes: Uint8Array, fileName: string, mimeType: string) => void;
  notifyError: (message: string) => void;
  onClose: () => void;
}) {
  const [layout, setLayout] = createSignal<PrintLayout>('slides');
  const [which, setWhich] = createSignal<'all' | 'current' | 'range'>('all');
  const [range, setRange] = createSignal('');
  const [hidden, setHidden] = createSignal(false);
  const [frame, setFrame] = createSignal(false);
  const [paper, setPaper] = createSignal<Paper>(
    defaultPaper(navigator.language || 'en-US')
  );
  const [progress, setProgress] = createSignal<string | null>(null);

  /** The slides to print, or an error message. */
  const chosen = (): number[] | string => {
    const count = props.deck.slides.length;
    const all = props.deck.slides.map((_, i) => i);
    const picked =
      which() === 'current'
        ? [props.current]
        : which() === 'range'
          ? parseSlideRange(range(), count)
          : all;
    if (!picked) return `Enter slides like 1-3, 5 (1 to ${count}).`;
    // Hidden slides print only when asked for, or picked one by one.
    const list =
      hidden() || which() === 'current'
        ? picked
        : picked.filter((i) => !props.deck.slides[i]?.hidden);
    return list.length > 0 ? list : 'No slides to print.';
  };
  const pages = () => {
    const c = chosen();
    return typeof c === 'string' ? [] : paginate(c, slidesPerPage(layout()));
  };
  const spec = () =>
    pageSpec(layout(), props.deck.width, props.deck.height, paper());

  const compose = async (
    each: (canvas: HTMLCanvasElement) => Promise<void>
  ) => {
    const list = pages();
    for (const [i, indexes] of list.entries()) {
      setProgress(`Preparing page ${i + 1} of ${list.length}…`);
      const canvas = await composePage(
        props.engine,
        props.deck,
        spec(),
        layout(),
        indexes,
        i + 1,
        frame()
      );
      await each(canvas);
    }
  };

  const run = async (task: () => Promise<void>) => {
    if (progress()) return;
    try {
      await task();
      props.onClose();
    } catch (e) {
      props.notifyError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  const print = () =>
    run(async () => {
      const urls: string[] = [];
      await compose(async (canvas) => {
        urls.push(URL.createObjectURL(await toBlob(canvas, 'image/png')));
      });
      await printImages(urls, spec());
    });

  const savePdf = () =>
    run(async () => {
      const out: PdfPage[] = [];
      const s = spec();
      await compose(async (canvas) => {
        const blob = await toBlob(canvas, 'image/jpeg', 0.92);
        out.push({
          width: s.width,
          height: s.height,
          jpeg: new Uint8Array(await blob.arrayBuffer()),
          pixelWidth: canvas.width,
          pixelHeight: canvas.height,
        });
      });
      const base = props.fileName.replace(/\.pptx?$/i, '') || 'Presentation';
      props.download(
        buildImagePdf(out, base),
        `${base}.pdf`,
        'application/pdf'
      );
    });

  const radio = 'flex items-center gap-2 text-ink text-sm';

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      class="w-[min(460px,92vw)]"
    >
      <div class="flex flex-col gap-4 p-4" data-testid="pptx-print">
        <div class="flex items-center justify-between">
          <h2 class="flex items-center gap-2 font-semibold text-ink text-sm">
            <Printer class="size-4" />
            Print
          </h2>
          <Button
            size="icon-sm"
            variant="ghost"
            label="Close"
            onClick={props.onClose}
          >
            <X />
          </Button>
        </div>
        <fieldset class="flex flex-col gap-1.5">
          <legend class="mb-1 font-medium text-ink-muted text-xs">
            Layout
          </legend>
          <For each={LAYOUTS}>
            {(l) => (
              <label class={radio}>
                <input
                  type="radio"
                  name="pptx-print-layout"
                  value={l.id}
                  checked={layout() === l.id}
                  data-testid={`pptx-print-layout-${l.id}`}
                  onChange={() => setLayout(l.id)}
                />
                {l.label}
              </label>
            )}
          </For>
        </fieldset>
        <fieldset class="flex flex-col gap-1.5">
          <legend class="mb-1 font-medium text-ink-muted text-xs">
            Slides
          </legend>
          <label class={radio}>
            <input
              type="radio"
              name="pptx-print-which"
              checked={which() === 'all'}
              onChange={() => setWhich('all')}
            />
            All slides
          </label>
          <label class={radio}>
            <input
              type="radio"
              name="pptx-print-which"
              checked={which() === 'current'}
              onChange={() => setWhich('current')}
            />
            Current slide ({props.current + 1})
          </label>
          <label class={radio}>
            <input
              type="radio"
              name="pptx-print-which"
              checked={which() === 'range'}
              onChange={() => setWhich('range')}
            />
            Slides
            <input
              type="text"
              class="h-7 w-32 rounded-md border border-edge-muted bg-input px-2 text-ink text-sm placeholder:text-ink-placeholder"
              placeholder="e.g. 1-3, 5"
              data-testid="pptx-print-range"
              value={range()}
              onFocus={() => setWhich('range')}
              onInput={(e) => setRange(e.currentTarget.value)}
            />
          </label>
        </fieldset>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label class={radio}>
            <input
              type="checkbox"
              checked={hidden()}
              onChange={(e) => setHidden(e.currentTarget.checked)}
            />
            Print hidden slides
          </label>
          <Show when={layout() === 'slides'}>
            <label class={radio}>
              <input
                type="checkbox"
                checked={frame()}
                onChange={(e) => setFrame(e.currentTarget.checked)}
              />
              Frame slides
            </label>
          </Show>
          <Show when={layout() !== 'slides'}>
            <label class={radio}>
              Paper
              <select
                class="h-7 rounded-md border border-edge-muted bg-input px-1 text-ink text-sm"
                value={paper()}
                onChange={(e) => setPaper(e.currentTarget.value as Paper)}
              >
                <option value="letter">Letter</option>
                <option value="a4">A4</option>
              </select>
            </label>
          </Show>
        </div>
        <div class="flex items-center gap-2">
          <span
            class="mr-auto text-ink-muted text-xs"
            data-testid="pptx-print-summary"
          >
            {progress() ??
              (typeof chosen() === 'string'
                ? (chosen() as string)
                : `${pages().length} page${pages().length === 1 ? '' : 's'}`)}
          </span>
          <Button
            size="sm"
            variant="ghost"
            data-testid="pptx-print-pdf"
            disabled={pages().length === 0 || !!progress()}
            onClick={() => void savePdf()}
          >
            <FilePdf />
            Save as PDF
          </Button>
          <Button
            size="sm"
            variant="cta"
            data-testid="pptx-print-go"
            disabled={pages().length === 0 || !!progress()}
            onClick={() => void print()}
          >
            <Printer />
            Print
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
