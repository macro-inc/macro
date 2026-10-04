import type {
  Clip,
  ClipParagraph,
  ClipRun,
  ListKind,
} from '@core/docx-engine/types';

/**
 * The clipboard for DOCX documents. A copy goes out as plain text and as
 * HTML that carries Macro's own form of the paragraphs in an attribute, so
 * pasting back into a DOCX keeps every run's formatting while other
 * applications read ordinary HTML. Pasted HTML from elsewhere (Word, Google
 * Docs, web pages) becomes paragraphs with headings, lists and basic
 * character formatting.
 */

const NATIVE = 'data-macro-docx';

type Native = { v: 1; doc: string; paragraphs: ClipParagraph[] };

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(data: string): string {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** The HTML a copy puts on the clipboard. */
export function clipboardHtml(clip: Clip, documentId: string): string {
  const native: Native = { v: 1, doc: documentId, paragraphs: clip.paragraphs };
  const body = clip.html.replace(/^<meta[^>]*>/, '');
  return `<meta charset="utf-8"><div ${NATIVE}="${toBase64(JSON.stringify(native))}">${body}</div>`;
}

type Format = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  superscript: boolean;
  subscript: boolean;
  /** Whitespace is kept as it is (`pre`, `pre-wrap`). */
  pre: boolean;
};

const PLAIN: Format = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  superscript: false,
  subscript: false,
  pre: false,
};

const SKIPPED = new Set([
  'SCRIPT',
  'STYLE',
  'HEAD',
  'TITLE',
  'META',
  'LINK',
  'TEMPLATE',
  'NOSCRIPT',
  'SVG',
  'IMG',
  'OBJECT',
  'IFRAME',
  'BUTTON',
  'SELECT',
  'INPUT',
  'TEXTAREA',
]);

const BLOCKS = new Set([
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'TR',
  'DT',
  'DD',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'ADDRESS',
  'FIGURE',
  'FIGCAPTION',
  'CENTER',
  'UL',
  'OL',
  'TABLE',
  'HR',
]);

/** Character formatting an element adds (or, through its style, removes). */
function formatOf(element: HTMLElement, outer: Format): Format {
  const f = { ...outer };
  switch (element.tagName) {
    case 'B':
    case 'STRONG':
      f.bold = true;
      break;
    case 'I':
    case 'EM':
    case 'CITE':
    case 'VAR':
      f.italic = true;
      break;
    case 'U':
    case 'INS':
      f.underline = true;
      break;
    case 'S':
    case 'STRIKE':
    case 'DEL':
      f.strike = true;
      break;
    case 'SUP':
      f.superscript = true;
      break;
    case 'SUB':
      f.subscript = true;
      break;
    case 'PRE':
      f.pre = true;
      break;
  }
  const style = element.style;
  const weight = style.fontWeight;
  if (weight) {
    const n = Number(weight);
    f.bold = Number.isFinite(n) ? n >= 600 : /bold/.test(weight);
  }
  if (style.fontStyle) f.italic = /italic|oblique/.test(style.fontStyle);
  const decoration = style.textDecorationLine || style.textDecoration;
  if (decoration) {
    f.underline = decoration.includes('underline');
    f.strike = decoration.includes('line-through');
  }
  const vertical = style.verticalAlign;
  if (vertical === 'super') f.superscript = true;
  if (vertical === 'sub') f.subscript = true;
  if (vertical === 'baseline') f.superscript = f.subscript = false;
  const space = style.whiteSpace;
  if (space) f.pre = /pre/.test(space);
  return f;
}

/** Word's list markup: `mso-list: l0 level2 lfo1` on a paragraph. */
function wordListLevel(element: HTMLElement): number | undefined {
  const match = /mso-list:\s*l\d+\s+level(\d+)/i.exec(
    element.getAttribute('style') ?? ''
  );
  return match ? Number(match[1]) - 1 : undefined;
}

function isWordListLabel(element: HTMLElement): boolean {
  return /mso-list:\s*ignore/i.test(element.getAttribute('style') ?? '');
}

/** Paragraphs from HTML that did not come from this editor. */
export function htmlToParagraphs(root: ParentNode): ClipParagraph[] {
  const out: ClipParagraph[] = [];
  let current: ClipParagraph = { runs: [] };
  /** Whether the paragraph so far ends in whitespace (for collapsing). */
  let trailingSpace = true;

  /**
   * Ends the paragraph being collected. An empty one is dropped but keeps
   * its heading or list settings for the block nested in it (a `<p>` inside
   * an `<li>`), unless `reset`.
   */
  const flush = (keepEmpty = false, reset = false) => {
    const runs = current.runs;
    const last = runs[runs.length - 1];
    if (last) last.text = last.text.replace(/[ \t]+$/, '');
    const filtered = runs.filter((r) => r.text.length > 0);
    if (filtered.length || keepEmpty) {
      out.push({ ...current, runs: filtered });
      current = { runs: [] };
    } else {
      current = reset ? { runs: [] } : { ...current, runs: [] };
    }
    trailingSpace = true;
  };

  const push = (text: string, f: Format) => {
    let t = text;
    if (!f.pre) {
      t = t.replace(/[\t\n\r ]+/g, ' ');
      if (trailingSpace) t = t.replace(/^ /, '');
    }
    if (!t) return;
    trailingSpace = /[ \t\n]$/.test(t);
    const run: ClipRun = { text: t };
    for (const key of [
      'bold',
      'italic',
      'underline',
      'strike',
      'superscript',
      'subscript',
    ] as const)
      if (f[key]) run[key] = true;
    const last = current.runs[current.runs.length - 1];
    const same =
      last &&
      [
        'bold',
        'italic',
        'underline',
        'strike',
        'superscript',
        'subscript',
      ].every((k) => !!last[k as keyof ClipRun] === !!run[k as keyof ClipRun]);
    if (same && last) last.text += t;
    else current.runs.push(run);
  };

  const walk = (
    node: Node,
    f: Format,
    list: { kind: ListKind; depth: number } | undefined,
    cells: { count: number }
  ) => {
    if (node.nodeType === Node.TEXT_NODE) {
      push(node.textContent ?? '', f);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    const tag = element.tagName.toUpperCase();
    if (SKIPPED.has(tag) || isWordListLabel(element)) return;
    if (tag === 'BR') {
      if (current.runs.length) push('\n', { ...f, pre: true });
      else flush(true);
      trailingSpace = true;
      return;
    }
    const format = formatOf(element, f);
    if (tag === 'TD' || tag === 'TH') {
      if (cells.count++ > 0) push('\t', { ...format, pre: true });
      for (const child of element.childNodes)
        walk(child, format, list, { count: 0 });
      return;
    }
    if (!BLOCKS.has(tag)) {
      for (const child of element.childNodes) walk(child, format, list, cells);
      return;
    }
    flush();
    let inner = list;
    if (tag === 'UL' || tag === 'OL') {
      inner = {
        kind: tag === 'UL' ? 'bullet' : 'number',
        depth: list ? list.depth + 1 : 0,
      };
    }
    if (/^H[1-6]$/.test(tag)) current.heading = Number(tag[1]);
    if (tag === 'LI' && list) {
      current.list = list.kind;
      current.level = list.depth;
    }
    const wordLevel = wordListLevel(element);
    if (wordLevel !== undefined) {
      const label = element.querySelector('[style*="mso-list"]');
      const text = (label?.textContent ?? '').trim();
      current.list = /^\(?[0-9a-zA-Z]{1,6}[.):]?$/.test(text)
        ? 'number'
        : 'bullet';
      current.level = wordLevel;
    }
    const rowCells = { count: 0 };
    for (const child of element.childNodes)
      walk(child, format, inner, tag === 'TR' ? rowCells : cells);
    flush(false, true);
  };

  for (const child of root.childNodes)
    walk(child, PLAIN, undefined, { count: 0 });
  // Text after the last block is an unfinished paragraph.
  const unfinished = current.runs.some((r) => r.text.trim());
  flush();
  // Several whole paragraphs end with their paragraph mark: what follows
  // the caret stays a paragraph of its own.
  if (out.length > 1 && !unfinished) out.push({ runs: [] });
  return out;
}

/**
 * What pasted HTML holds: this editor's own paragraphs (and whether they
 * came from the same document), or paragraphs read from foreign HTML.
 */
export function readClipboardHtml(
  html: string,
  documentId: string
): { paragraphs: ClipParagraph[]; sameDocument: boolean } {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const marked = parsed.querySelector(`[${NATIVE}]`);
  const data = marked?.getAttribute(NATIVE);
  if (data) {
    try {
      const native = JSON.parse(fromBase64(data)) as Native;
      if (native.v === 1 && Array.isArray(native.paragraphs))
        return {
          paragraphs: native.paragraphs,
          sameDocument: native.doc === documentId,
        };
    } catch {
      // Not ours after all: read it as HTML.
    }
  }
  return { paragraphs: htmlToParagraphs(parsed.body), sameDocument: false };
}
