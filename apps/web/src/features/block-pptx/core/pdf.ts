/**
 * A minimal PDF writer: one JPEG image per page, filling it. Enough to save
 * printed slides, notes pages, and handouts as a PDF without a library.
 */

export interface PdfPage {
  /** Page size in points. */
  width: number;
  height: number;
  /** Baseline JPEG data and its pixel size. */
  jpeg: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
}

const encoder = new TextEncoder();

/** PDF text string literal with `(`, `)`, and `\` escaped. */
function literal(text: string): string {
  // Non-ASCII titles fall back to `?`: PDFDocEncoding is Latin-only.
  const ascii = [...text]
    .map((c) => (c.charCodeAt(0) < 128 ? c : '?'))
    .join('');
  return `(${ascii.replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

const num = (n: number) => String(Math.round(n * 100) / 100);

export function buildImagePdf(pages: PdfPage[], title = ''): Uint8Array {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: () => void) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    body();
    push('\nendobj\n');
  };

  // Objects: 1 catalog, 2 page tree, 3 info, then per page: page, content,
  // image.
  const pageId = (i: number) => 4 + i * 3;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  object(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  object(2, () =>
    push(
      `<< /Type /Pages /Count ${pages.length} /Kids [${pages
        .map((_, i) => `${pageId(i)} 0 R`)
        .join(' ')}] >>`
    )
  );
  object(3, () => push(`<< /Title ${literal(title)} /Producer (Macro) >>`));
  pages.forEach((page, i) => {
    const id = pageId(i);
    const w = num(page.width);
    const h = num(page.height);
    object(id, () =>
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`
      )
    );
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    object(id + 1, () =>
      push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
    );
    object(id + 2, () => {
      push(
        `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`
      );
      push(page.jpeg);
      push('\nendstream');
    });
  });
  const count = 4 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++)
    push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(
    `trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  );

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
