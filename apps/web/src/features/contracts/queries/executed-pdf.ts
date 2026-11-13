import { buildImagePdf, type PdfPage } from '@app/features/block-pptx/core/pdf';
import { ResultAsync } from 'neverthrow';
import type { PdfDocument } from '../context/contracts-context';
import type { CertificateSheet, SheetFact } from '../core/certificate-sheet';
import type { AdoptedSignature, Packet, PacketDocument } from '../core/packet';
import { type PrintedField, printedFields } from '../core/printed-fields';
import { SIGNATURE_INK, signatureFontFamily } from '../core/signature-style';

export type ExecutedPdfInput = {
  packet: Packet;
  /** The packet's documents, opened, in packet order. */
  documents: { document: PacketDocument; pdf: PdfDocument }[];
  sheet: CertificateSheet;
  /** How a signing date prints in a Date Signed field. */
  formatDate: (iso: string) => string;
};

/** Width every page is painted at: about 150 dpi on a Letter page. */
const PAGE_PIXELS = 1240;
const JPEG_QUALITY = 0.92;
const LETTER = { width: 612, height: 792 };

const SANS = "'Inter Variable', Inter, system-ui, sans-serif";
const MONO = "'Roboto Mono Variable', ui-monospace, monospace";
const INK = '#141414';
const MUTED = '#595959';
const RULE = '#d4d4d4';

/** On-page text is this fraction of the page width, as it is on screen. */
const FIELD_TEXT_SCALE = 0.019;
const MARK_HEIGHT_SCALE = 0.72;

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot draw the PDF');
  return context;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('The page could not be encoded'));
      },
      'image/jpeg',
      JPEG_QUALITY
    );
  });
}

async function toJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Uint8Array(await (await toBlob(canvas)).arrayBuffer());
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('A signature image is unreadable'));
    image.src = dataUrl;
  });
}

type Rect = { x: number; y: number; width: number; height: number };

/** Draw an adopted mark inside a box: text scaled to it, images fitted. */
async function drawMark(
  context: CanvasRenderingContext2D,
  mark: AdoptedSignature,
  box: Rect
) {
  if (mark.kind === 'typed') {
    const family = signatureFontFamily(mark.style);
    let size = box.height * MARK_HEIGHT_SCALE;
    context.font = `${size}px ${family}`;
    const width = context.measureText(mark.text).width;
    // A long name shrinks to its box instead of being cut off.
    if (width > box.width) {
      size *= box.width / width;
      context.font = `${size}px ${family}`;
    }
    context.fillStyle = SIGNATURE_INK;
    context.textBaseline = 'middle';
    context.fillText(mark.text, box.x, box.y + box.height / 2);
    return;
  }

  const image = await loadImage(mark.dataUrl);
  const scale = Math.min(
    box.width / image.naturalWidth,
    box.height / image.naturalHeight
  );
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.drawImage(
    image,
    box.x,
    box.y + (box.height - height) / 2,
    width,
    height
  );
}

function drawCheck(context: CanvasRenderingContext2D, box: Rect) {
  const side = Math.min(box.width, box.height);
  const x = box.x;
  const y = box.y + (box.height - side) / 2;
  context.strokeStyle = INK;
  context.lineWidth = Math.max(side * 0.12, 1.5);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(x + side * 0.2, y + side * 0.55);
  context.lineTo(x + side * 0.42, y + side * 0.76);
  context.lineTo(x + side * 0.82, y + side * 0.26);
  context.stroke();
}

async function drawField(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  field: PrintedField
) {
  const box: Rect = {
    x: field.box.xPct * canvas.width,
    y: field.box.yPct * canvas.height,
    width: field.box.widthPct * canvas.width,
    height: field.box.heightPct * canvas.height,
  };
  context.save();
  context.beginPath();
  context.rect(box.x, box.y, box.width, box.height);
  context.clip();

  if (field.print.t === 'mark') await drawMark(context, field.print.mark, box);
  if (field.print.t === 'check') drawCheck(context, box);
  if (field.print.t === 'text') {
    context.font = `${canvas.width * FIELD_TEXT_SCALE}px ${SANS}`;
    context.fillStyle = '#1c1c1c';
    context.textBaseline = 'middle';
    context.fillText(field.print.text, box.x, box.y + box.height / 2);
  }
  context.restore();
}

/** One page of a document, as signed so far. */
async function documentPage(
  input: ExecutedPdfInput,
  document: PacketDocument,
  pdf: PdfDocument,
  page: number
): Promise<PdfPage> {
  const canvas = globalThis.document.createElement('canvas');
  const size = await pdf.pageSize(page);
  await pdf.paintPage(page, canvas, PAGE_PIXELS);

  const context = context2d(canvas);
  const fields = printedFields(
    input.packet,
    document.id,
    page,
    input.formatDate
  );
  for (const field of fields) await drawField(canvas, context, field);

  return {
    width: size.width,
    height: size.height,
    jpeg: await toJpeg(canvas),
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
  };
}

/**
 * The certificate laid out on Letter pages. Positions are in points; the
 * canvas is scaled so a point is drawn at the same density as the documents.
 */
class CertificatePages {
  readonly canvases: HTMLCanvasElement[] = [];
  private context!: CanvasRenderingContext2D;
  private y = 0;

  private static readonly MARGIN = 42;
  private static readonly TOP = 39;
  private static readonly BOTTOM = LETTER.height - 36;
  private static readonly WIDTH = LETTER.width - CertificatePages.MARGIN * 2;

  constructor() {
    this.addPage();
  }

  private addPage() {
    const canvas = globalThis.document.createElement('canvas');
    const scale = PAGE_PIXELS / LETTER.width;
    canvas.width = PAGE_PIXELS;
    canvas.height = Math.round(LETTER.height * scale);
    const context = context2d(canvas);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(scale, scale);
    context.textBaseline = 'alphabetic';
    this.canvases.push(canvas);
    this.context = context;
    this.y = CertificatePages.TOP;
  }

  /** Start a new page unless `height` more points fit on this one. */
  private need(height: number) {
    if (this.y + height > CertificatePages.BOTTOM) this.addPage();
  }

  private font(size: number, options: { bold?: boolean; mono?: boolean } = {}) {
    const weight = options.bold ? 600 : 400;
    this.context.font = `${weight} ${size}px ${options.mono ? MONO : SANS}`;
  }

  /** Break text into lines no wider than `width`, splitting long words. */
  private wrap(text: string, width: number): string[] {
    const lines: string[] = [];
    let line = '';
    const fits = (candidate: string) =>
      this.context.measureText(candidate).width <= width;

    for (const word of text.split(/\s+/).filter(Boolean)) {
      const joined = line ? `${line} ${word}` : word;
      if (fits(joined)) {
        line = joined;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      // A hash or a long token has no spaces to break at.
      let rest = word;
      while (!fits(rest) && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && !fits(rest.slice(0, cut))) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    if (line) lines.push(line);
    return lines.length > 0 ? lines : [''];
  }

  private lines(lines: string[], x: number, lineHeight: number, color: string) {
    this.context.fillStyle = color;
    for (const [index, line] of lines.entries()) {
      this.context.fillText(line, x, this.y + lineHeight * (index + 0.75));
    }
  }

  private rule(color: string, thickness: number) {
    this.context.fillStyle = color;
    this.context.fillRect(
      CertificatePages.MARGIN,
      this.y,
      CertificatePages.WIDTH,
      thickness
    );
  }

  private heading(text: string) {
    this.need(40);
    this.y += 15;
    this.font(8.25, { bold: true });
    this.context.fillStyle = MUTED;
    this.context.fillText(
      text.toUpperCase(),
      CertificatePages.MARGIN,
      this.y + 8
    );
    this.y += 16;
  }

  header(sheet: CertificateSheet) {
    const left = CertificatePages.MARGIN;
    this.font(16.5, { bold: true });
    this.context.fillStyle = INK;
    this.context.fillText(sheet.title, left, this.y + 16);

    if (sheet.completed) {
      this.font(9, { bold: true });
      const width = this.context.measureText(sheet.completed).width + 22;
      const x = left + CertificatePages.WIDTH - width;
      this.context.strokeStyle = INK;
      this.context.lineWidth = 0.75;
      this.context.beginPath();
      this.context.roundRect(x, this.y + 2, width, 18, 9);
      this.context.stroke();
      this.context.fillStyle = INK;
      this.context.fillText(sheet.completed, x + 11, this.y + 14.5);
    }
    this.y += 22;

    this.font(9);
    const subtitle = this.wrap(sheet.subtitle, CertificatePages.WIDTH);
    this.lines(subtitle, left, 13.5, MUTED);
    this.y += subtitle.length * 13.5 + 10;
    this.rule(INK, 1.5);
    this.y += 14;
  }

  /** Label and value pairs, two to a row. */
  facts(facts: SheetFact[]) {
    const half = CertificatePages.WIDTH / 2;
    const label = 78;
    for (let index = 0; index < facts.length; index += 2) {
      const row = facts.slice(index, index + 2);
      this.font(9);
      const values = row.map((fact) =>
        this.wrap(fact.value, half - label - 12)
      );
      const height = Math.max(...values.map((value) => value.length)) * 13.5;
      this.need(height);
      for (const [column, fact] of row.entries()) {
        const x = CertificatePages.MARGIN + column * half;
        this.lines([fact.label], x, 13.5, MUTED);
        this.lines(values[column], x + label, 13.5, INK);
      }
      this.y += height + 3;
    }
  }

  /** Label and value pairs whose value takes the rest of the row. */
  wideFacts(facts: SheetFact[], label = 78, size = 9, mono = false) {
    const lineHeight = size * 1.5;
    for (const fact of facts) {
      this.font(size, { mono });
      const value = this.wrap(fact.value, CertificatePages.WIDTH - label);
      this.font(size);
      const name = this.wrap(fact.label, label - 8);
      const height = Math.max(value.length, name.length) * lineHeight;
      this.need(height);
      this.lines(name, CertificatePages.MARGIN, lineHeight, mono ? INK : MUTED);
      this.font(size, { mono });
      this.lines(value, CertificatePages.MARGIN + label, lineHeight, INK);
      this.y += height + 3;
    }
  }

  async signers(sheet: CertificateSheet) {
    this.heading(sheet.signersHeading);
    const gap = 12;
    const width = (CertificatePages.WIDTH - gap) / 2;
    const label = 64;
    const padding = 10;

    for (let index = 0; index < sheet.signers.length; index += 2) {
      const row = sheet.signers.slice(index, index + 2);
      this.font(8.25);
      const wrapped = row.map((signer) =>
        signer.facts.map((fact) =>
          this.wrap(fact.value, width - padding * 2 - label)
        )
      );
      const bodies = wrapped.map((facts) =>
        facts.reduce((total, lines) => total + lines.length * 12.5, 0)
      );
      const height = 46 + Math.max(...bodies) + padding;
      this.need(height + gap);

      for (const [column, signer] of row.entries()) {
        const x = CertificatePages.MARGIN + column * (width + gap);
        const top = this.y;
        this.context.strokeStyle = RULE;
        this.context.lineWidth = 0.75;
        this.context.beginPath();
        this.context.roundRect(x, top, width, height, 7.5);
        this.context.stroke();

        this.font(10.5, { bold: true });
        this.context.fillStyle = INK;
        this.context.fillText(signer.name, x + padding, top + 20);
        this.font(9);
        this.context.fillStyle = MUTED;
        this.context.fillText(signer.position, x + padding, top + 33);
        if (signer.signature) {
          await drawMark(this.context, signer.signature, {
            x: x + width - padding - 110,
            y: top + 9,
            width: 110,
            height: 27,
          });
        }
        this.context.fillStyle = '#e4e4e4';
        this.context.fillRect(x + padding, top + 40, width - padding * 2, 0.75);

        let y = top + 46;
        this.font(8.25);
        for (const [factIndex, fact] of signer.facts.entries()) {
          const lines = wrapped[column][factIndex];
          this.context.fillStyle = MUTED;
          this.context.fillText(fact.label, x + padding, y + 9);
          this.context.fillStyle = INK;
          for (const [lineIndex, line] of lines.entries()) {
            this.context.fillText(
              line,
              x + padding + label,
              y + 9 + lineIndex * 12.5
            );
          }
          y += lines.length * 12.5;
        }
      }
      this.y += height + gap;
    }
  }

  hashes(sheet: CertificateSheet) {
    if (sheet.hashes.length === 0) return;
    this.heading(sheet.hashesHeading);
    this.wideFacts(sheet.hashes, 126, 8, true);
  }

  events(sheet: CertificateSheet) {
    this.heading(sheet.eventsHeading);
    const left = CertificatePages.MARGIN;
    const typeAt = left + 122;
    const textAt = left + 262;

    for (const event of sheet.events) {
      this.font(8.5);
      const text = this.wrap(
        event.text,
        left + CertificatePages.WIDTH - textAt
      );
      const height = text.length * 12.5 + 4;
      this.need(height);
      this.lines([event.at], left, 12.5, INK);
      this.lines(text, textAt, 12.5, '#3d3d3d');
      this.font(7.75, { mono: true });
      this.lines([event.type], typeAt, 12.5, INK);
      this.y += height;
      this.rule('#ececec', 0.75);
      this.y += 3;
    }
  }

  footer(sheet: CertificateSheet) {
    this.font(7.9);
    const lines = this.wrap(sheet.footer, 420);
    const height = lines.length * 11.5;
    this.need(height + 12);
    // The note sits at the foot of the last page, as it does on screen.
    this.y = Math.max(this.y + 12, CertificatePages.BOTTOM - height);
    this.lines(lines, CertificatePages.MARGIN, 11.5, MUTED);
  }
}

async function certificatePages(sheet: CertificateSheet): Promise<PdfPage[]> {
  const pages = new CertificatePages();
  pages.header(sheet);
  pages.facts(sheet.facts);
  pages.wideFacts(sheet.wideFacts);
  await pages.signers(sheet);
  pages.hashes(sheet);
  pages.events(sheet);
  pages.footer(sheet);

  const out: PdfPage[] = [];
  for (const canvas of pages.canvases) {
    out.push({
      width: LETTER.width,
      height: LETTER.height,
      jpeg: await toJpeg(canvas),
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
    });
  }
  return out;
}

/**
 * The packet as one PDF: every document page as signed so far, then the
 * Certificate of Completion. Pages are flattened to images, so a signature
 * cannot be lifted off or the text under it edited in a PDF editor.
 */
export async function buildExecutedPdf(input: ExecutedPdfInput): Promise<Blob> {
  // The faces load with the app; drawing waits for them rather than falling
  // back to a system face on a cold start.
  await ResultAsync.fromPromise(
    Promise.all([
      globalThis.document.fonts.load(`400 9px ${SANS}`),
      globalThis.document.fonts.load(`600 9px ${SANS}`),
      globalThis.document.fonts.load(`400 8px ${MONO}`),
    ]),
    () => undefined
  );

  const pages: PdfPage[] = [];
  for (const { document, pdf } of input.documents) {
    for (let page = 0; page < pdf.pageCount; page++) {
      pages.push(await documentPage(input, document, pdf, page));
    }
  }
  pages.push(...(await certificatePages(input.sheet)));

  const bytes = buildImagePdf(pages, input.packet.title);
  return new Blob([bytes.slice().buffer], { type: 'application/pdf' });
}
