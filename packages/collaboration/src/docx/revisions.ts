import { localName } from './paragraph';
import {
  decodeXml,
  elementChildren,
  escapeAttribute,
  parseElement,
  parseXml,
  serializeXml,
  type XmlElement,
} from './xml';

/**
 * Tracked changes (`w:ins`, `w:del`, `w:rPrChange`, `w:pPrChange`) as the
 * DOCX engine stores them in the shared format: text revisions are entries
 * of a span's `wrap` attribute (JSON `[[open, close], ...]`, outermost
 * first), a paragraph mark's revision sits in its `w:pPr/w:rPr`, and a
 * formatting change is the run property `r:w:rPrChange`. Word shows these as
 * real revisions anyone can accept or reject, attributed to their author.
 */

export type Wrapper = [open: string, close: string];
type Attributes = Record<string, string>;

/** Wrappers around a span's text, outermost first. */
export function wrappersOf(attrs: Attributes | undefined): Wrapper[] {
  const wrap = attrs?.wrap;
  if (!wrap) return [];
  try {
    const parsed = JSON.parse(wrap) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (w): w is Wrapper =>
            Array.isArray(w) &&
            typeof w[0] === 'string' &&
            typeof w[1] === 'string'
        )
      : [];
  } catch {
    return [];
  }
}

/** The `wrap` attribute value of a wrapper stack, or `null` for none. */
export function encodeWrappers(stack: readonly Wrapper[]): string | null {
  return stack.length ? JSON.stringify(stack) : null;
}

/** The local name of a start tag (`<w:ins w:id="1">` → `ins`). */
export function tagLocal(open: string): string {
  const name = /^<\s*([^\s/>]+)/.exec(open)?.[1] ?? '';
  return name.slice(name.indexOf(':') + 1);
}

/** An attribute of a start tag by local name, decoded. */
export function tagAttribute(open: string, local: string): string | null {
  const match = new RegExp(
    `[\\s:]${local}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`
  ).exec(open);
  if (!match) return null;
  return decodeXml(match[1] ?? match[2] ?? '');
}

export const isInserted = (w: Wrapper) =>
  ['ins', 'moveTo'].includes(tagLocal(w[0]));
export const isDeleted = (w: Wrapper) =>
  ['del', 'moveFrom'].includes(tagLocal(w[0]));
export const isRevision = (w: Wrapper) => isInserted(w) || isDeleted(w);

/** Schema order of run properties (CT_RPr); `rPrChange` always goes last. */
const RPR_ORDER = [
  'rStyle',
  'rFonts',
  'b',
  'bCs',
  'i',
  'iCs',
  'caps',
  'smallCaps',
  'strike',
  'dstrike',
  'outline',
  'shadow',
  'emboss',
  'imprint',
  'noProof',
  'snapToGrid',
  'vanish',
  'webHidden',
  'color',
  'spacing',
  'w',
  'kern',
  'position',
  'sz',
  'szCs',
  'highlight',
  'u',
  'effect',
  'bdr',
  'shd',
  'fitText',
  'vertAlign',
  'rtl',
  'cs',
  'em',
  'lang',
  'eastAsianLayout',
  'specVanish',
  'oMath',
];

function rprRank(qname: string): number {
  const colon = qname.indexOf(':');
  const prefix = colon < 0 ? '' : qname.slice(0, colon);
  const local = qname.slice(colon + 1);
  // Extension elements (w14:, w15:...) follow the base properties.
  const base = !prefix || !prefix.startsWith('w') || prefix.length === 1;
  const index = RPR_ORDER.indexOf(local);
  return base && index >= 0 ? index : RPR_ORDER.length + 1;
}

/** A toggle turned off, which shows the same as no property at all. */
const OFF = /:val="(?:0|false|off|none)"/;

/** Run property marks (`r:` keys) other than a recorded change, sorted. */
function runProps(attrs: Attributes): Array<[string, string]> {
  return Object.entries(attrs)
    .filter(([k]) => k.startsWith('r:') && !k.endsWith(':rPrChange'))
    .map(([k, v]): [string, string] => [k.slice(2), v])
    .sort((a, b) => rprRank(a[0]) - rprRank(b[0]) || (a[0] < b[0] ? -1 : 1));
}

/** Who records tracked changes, and when. */
export class Revisor {
  private next: number;

  constructor(
    /** The document's WordprocessingML prefix. */
    readonly w: string,
    /** The name revisions are attributed to. */
    readonly author: string,
    /** When (ISO 8601, seconds precision). */
    readonly date: string
  ) {
    // Revision ids only need to be distinct; a random base keeps one edit's
    // ids apart from the ids earlier edits and people recorded.
    this.next = 1 + Math.floor(Math.random() * 0x3fff_0000);
  }

  private q(local: string) {
    return this.w ? `${this.w}:${local}` : local;
  }

  /** `w:id`, `w:author` and `w:date` of a new revision element. */
  private attributes(): string {
    const id = this.next++;
    const date = this.date ? ` ${this.q('date')}="${this.date}"` : '';
    return ` ${this.q('id')}="${id}" ${this.q('author')}="${escapeAttribute(this.author)}"${date}`;
  }

  /** A new revision element wrapping runs (`ins` or `del`). */
  wrapper(local: 'ins' | 'del'): Wrapper {
    return [`<${this.q(local)}${this.attributes()}>`, `</${this.q(local)}>`];
  }

  /** A new revision mark for a paragraph mark or table row. */
  mark(local: 'ins' | 'del'): string {
    return `<${this.q(local)}${this.attributes()}/>`;
  }

  /** Whether a wrapper is an insertion this author made. */
  owns(w: Wrapper): boolean {
    return isInserted(w) && tagAttribute(w[0], 'author') === this.author;
  }

  /** The attributes of text inserted with formatting `base`: its own
   * elements (hyperlinks...) inside a new insertion by the author. */
  inserted(base: Attributes, insertion: Wrapper): Attributes {
    const out: Attributes = {};
    for (const [key, value] of Object.entries(base))
      if (key !== 'wrap' && !key.endsWith(':rPrChange')) out[key] = value;
    const stack = wrappersOf(base).filter((w) => !isRevision(w));
    stack.push(insertion);
    out.wrap = encodeWrappers(stack)!;
    return out;
  }

  /** The `r:w:rPrChange` value for a run whose formatting goes from `old`
   * to `next`: the formatting from before, the earliest record kept.
   * `undefined` when there is nothing to record (unchanged, or text
   * tracked as inserted, which is new anyway). */
  formatChange(old: Attributes, next: Attributes): string | undefined {
    const before = runProps(old);
    const shown = (props: Array<[string, string]>) =>
      JSON.stringify(props.filter(([, xml]) => !OFF.test(xml)));
    if (shown(before) === shown(runProps(next))) return undefined;
    if (wrappersOf(old).some(isInserted)) return undefined;
    const existing = Object.entries(old).find(([k]) =>
      k.endsWith(':rPrChange')
    )?.[1];
    if (existing) return existing;
    const tag = this.q('rPrChange');
    const rpr = this.q('rPr');
    return `<${tag}${this.attributes()}><${rpr}>${before.map(([, x]) => x).join('')}</${rpr}></${tag}>`;
  }

  /** A new `w:pPrChange` holding a paragraph's recorded properties. */
  paragraphChange(recorded: string): string {
    const tag = this.q('pPrChange');
    const ppr = this.q('pPr');
    return `<${tag}${this.attributes()}><${ppr}>${recorded}</${ppr}></${tag}>`;
  }
}

/** The current time as Word records revisions: ISO 8601 without
 * fractional seconds. */
export function revisionDate(now = new Date()): string {
  return `${now.toISOString().split('.')[0]}Z`;
}

/** Whether a settings part turns tracked changes on. */
export function tracksRevisions(settings: string | undefined): boolean {
  if (!settings) return false;
  const match = /<(?:\w+:)?trackRevisions\b([^>]*)\/?>/.exec(settings);
  if (!match) return false;
  const val = /:val\s*=\s*"([^"]*)"/.exec(match[1])?.[1];
  return val === undefined || !['0', 'false', 'off'].includes(val);
}

/** A properties element (`w:pPr`, `w:trPr`), new when `xml` is empty. */
function propsElement(w: string, local: string, xml: string): XmlElement {
  return xml.trim()
    ? parseElement(xml)
    : {
        kind: 'element',
        name: `${w}:${local}`,
        attributes: [],
        children: [],
        selfClosing: true,
      };
}

const REVISION_MARKS = ['ins', 'del', 'moveFrom', 'moveTo'];

/** The revision on a paragraph's mark: inserted or deleted, and by whom. */
export function markRevision(
  props: string
): { inserted: boolean; author: string | null } | null {
  if (!/(ins|del|move)/.test(props)) return null;
  const ppr = propsElement('w', 'pPr', props);
  const rpr = elementChildren(ppr).find((c) => localName(c) === 'rPr');
  const mark = rpr
    ? elementChildren(rpr).find((c) => REVISION_MARKS.includes(localName(c)))
    : undefined;
  if (!mark) return null;
  const tag = serializeXml({ ...mark, children: [] });
  return {
    inserted: ['ins', 'moveTo'].includes(localName(mark)),
    author: tagAttribute(tag, 'author'),
  };
}

/** Paragraph properties with `mark` (a `w:ins` or `w:del`) on the
 * paragraph mark, replacing any revision it had. */
export function withMarkRevision(
  w: string,
  props: string,
  mark: string
): string {
  const ppr = propsElement(w, 'pPr', props);
  let rpr = elementChildren(ppr).find((c) => localName(c) === 'rPr');
  if (!rpr) {
    rpr = propsElement(w, 'rPr', '');
    // rPr precedes the section break and recorded change.
    const at = ppr.children.findIndex(
      (c) =>
        c.kind === 'element' && ['sectPr', 'pPrChange'].includes(localName(c))
    );
    ppr.children.splice(at < 0 ? ppr.children.length : at, 0, rpr);
  }
  rpr.children = rpr.children.filter(
    (c) => c.kind !== 'element' || !REVISION_MARKS.includes(localName(c))
  );
  // Revision marks come first in a paragraph mark's run properties.
  rpr.children.unshift(...parseXml(mark));
  return serializeXml(ppr);
}

/** Paragraph properties that a tracked property change records: all but
 * the mark's formatting, the section break and an earlier record. */
function recordedProps(ppr: XmlElement): string {
  return serializeXml(
    elementChildren(ppr).filter(
      (c) => !['rPr', 'sectPr', 'pPrChange'].includes(localName(c))
    )
  );
}

/** `after` with a `w:pPrChange` keeping the properties from `before`, as
 * Word records a tracked paragraph change. Nothing is recorded for a
 * paragraph the edit leaves as it was or whose mark is inserted (it is new
 * anyway), and an earlier record is kept. */
export function withParagraphChange(
  w: string,
  before: string,
  after: string,
  rev: Revisor
): string {
  const old = propsElement(w, 'pPr', before);
  const next = propsElement(w, 'pPr', after);
  const recorded = recordedProps(old);
  if (recorded === recordedProps(next)) return after;
  if (markRevision(before)?.inserted) return after;
  if (elementChildren(next).some((c) => localName(c) === 'pPrChange'))
    return after;
  next.children.push(...parseXml(rev.paragraphChange(recorded)));
  return serializeXml(next);
}

/** Table row properties with the row marked deleted (`w:trPr/w:del`). */
export function withRowDeleted(w: string, props: string, rev: Revisor): string {
  const nodes = props.trim() ? parseXml(props) : [];
  let trpr = nodes.find(
    (n): n is XmlElement => n.kind === 'element' && localName(n) === 'trPr'
  );
  if (!trpr) {
    trpr = propsElement(w, 'trPr', '');
    nodes.push(trpr);
  }
  if (elementChildren(trpr).some((c) => localName(c) === 'del')) return props;
  trpr.children = trpr.children.filter(
    (c) => c.kind !== 'element' || localName(c) !== 'ins'
  );
  // del follows the row properties and precedes a recorded change.
  const at = trpr.children.findIndex(
    (c) => c.kind === 'element' && localName(c) === 'trPrChange'
  );
  trpr.children.splice(
    at < 0 ? trpr.children.length : at,
    0,
    ...parseXml(rev.mark('del'))
  );
  return serializeXml(nodes);
}
