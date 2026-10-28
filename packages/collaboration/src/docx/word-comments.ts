import type { LoroDoc } from 'loro-crdt';
import { decodeXml, escapeAttribute, escapeText } from './xml';

/**
 * Word's own comments (`word/comments.xml`) in the shared format: the part
 * is an entry of `wordParts`, related to the main part through `wordRels`
 * and typed in `wordTypes`. These are what Word shows in its comment
 * balloons, so comments written here travel with the file; Macro's editor
 * shows them beside the pages as comments "in the document".
 */

const CONTAINERS = {
  parts: 'wordParts',
  types: 'wordTypes',
  rels: 'wordRels',
} as const;

const WORDML_NS =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const COMMENTS_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const COMMENTS_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
/** Where the main part's shell holds the body's blocks. */
const BLOCKS = '<!--docx-blocks-->';

export type WordComment = {
  id: string;
  author: string;
  date: string | null;
  text: string;
};

function partText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!value.startsWith('b64:')) return value;
  const bytes = Uint8Array.from(atob(value.slice(4)), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** The main document part's name as stored (`/word/document.xml`). */
function mainPart(doc: LoroDoc): string {
  const parts = doc.getMap(CONTAINERS.parts);
  let found: string | undefined;
  for (const name of parts.keys()) {
    if (!/document2?\.xml$/.test(name)) continue;
    const value = parts.get(name);
    if (typeof value === 'string' && value.includes(BLOCKS)) return name;
    found ??= name;
  }
  return found ?? '/word/document.xml';
}

function directory(part: string): string {
  return part.slice(0, part.lastIndexOf('/') + 1);
}

/** The relationships part of `part` (`/word/_rels/document.xml.rels`). */
function relsPart(part: string): string {
  const dir = directory(part);
  return `${dir}_rels/${part.slice(dir.length)}.rels`;
}

/** A relationship target resolved against the part it is relative to. */
function resolve(base: string, target: string): string {
  if (target.startsWith('/')) return target;
  const segments = directory(base).split('/').filter(Boolean);
  for (const segment of target.split('/')) {
    if (segment === '..') segments.pop();
    else if (segment && segment !== '.') segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return match ? decodeXml(match[1]) : null;
}

/** The comments part the main part relates to, if any. */
function relatedComments(doc: LoroDoc, main: string): string | null {
  const rels = doc.getMap(CONTAINERS.rels);
  const prefix = `${relsPart(main)}|`;
  for (const key of rels.keys()) {
    if (!key.startsWith(prefix)) continue;
    const xml = rels.get(key);
    if (typeof xml !== 'string' || attribute(xml, 'Type') !== COMMENTS_REL)
      continue;
    const target = attribute(xml, 'Target');
    if (target) return resolve(main, target);
  }
  return null;
}

/** The prefix a part binds to WordprocessingML. */
function wordPrefix(xml: string): string {
  const match = new RegExp(
    `xmlns:(\\w+)="${WORDML_NS.replace(/[./]/g, '\\$&')}"`
  ).exec(xml);
  return match?.[1] ?? 'w';
}

/** The plain text of a comment's XML, one line per paragraph. */
function commentText(xml: string, w: string): string {
  const paragraphs = xml.split(new RegExp(`</${w}:p>`));
  return paragraphs
    .map((p) =>
      [
        ...p.matchAll(
          new RegExp(`<${w}:(t|tab|br)\\b[^>]*?(?:/>|>([^<]*)</${w}:t>)`, 'g')
        ),
      ]
        .map((m) =>
          m[1] === 't' ? decodeXml(m[2] ?? '') : m[1] === 'tab' ? '\t' : '\n'
        )
        .join('')
    )
    .join('\n')
    .trim();
}

/** The comments the document's comments part holds, by id. */
export function readWordComments(doc: LoroDoc): Map<string, WordComment> {
  const out = new Map<string, WordComment>();
  const name = relatedComments(doc, mainPart(doc));
  if (!name) return out;
  const xml = partText(doc.getMap(CONTAINERS.parts).get(name));
  if (!xml) return out;
  const w = wordPrefix(xml);
  const pattern = new RegExp(
    `<${w}:comment\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${w}:comment>)`,
    'g'
  );
  for (const match of xml.matchAll(pattern)) {
    const tag = ` ${match[1]}`;
    const id = attribute(tag, `${w}:id`);
    if (id === null) continue;
    out.set(id, {
      id,
      author: attribute(tag, `${w}:author`) ?? '',
      date: attribute(tag, `${w}:date`),
      text: commentText(match[2] ?? '', w),
    });
  }
  return out;
}

function initials(author: string): string {
  return author
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => [...word][0]!.toUpperCase())
    .slice(0, 3)
    .join('');
}

/** New comments one edit adds, written to the comments part at the end. */
export class WordCommentWriter {
  private readonly added: string[] = [];
  private nextId: number;
  /** The comments part's name and current text, when it exists. */
  private readonly name: string;
  private readonly related: boolean;
  private readonly existing: string | undefined;
  /** The prefix the comments are written with: the part's own. */
  private readonly w: string;

  constructor(private readonly doc: LoroDoc) {
    const ids = [...readWordComments(doc).keys()]
      .map(Number)
      .filter(Number.isInteger);
    this.nextId = ids.length ? Math.max(...ids) + 1 : 0;
    const main = mainPart(doc);
    const related = relatedComments(doc, main);
    this.related = related !== null;
    this.name = related ?? `${directory(main)}comments.xml`;
    this.existing = partText(doc.getMap(CONTAINERS.parts).get(this.name));
    this.w = this.existing ? wordPrefix(this.existing) : 'w';
  }

  /** Records a comment; returns its id for the markers in the text. */
  add(author: string, date: string, text: string): string {
    const id = String(this.nextId++);
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const q = (local: string) => `${this.w}:${local}`;
    const paragraphs = lines
      .map((line, i) => {
        const ref =
          i === 0 ? `<${q('r')}><${q('annotationRef')}/></${q('r')}>` : '';
        const run = line
          ? `<${q('r')}><${q('t')} xml:space="preserve">${escapeText(line)}</${q('t')}></${q('r')}>`
          : '';
        return `<${q('p')}>${ref}${run}</${q('p')}>`;
      })
      .join('');
    const short = initials(author);
    this.added.push(
      `<${q('comment')} ${q('id')}="${id}" ${q('author')}="${escapeAttribute(author)}" ${q('date')}="${escapeAttribute(date)}"${short ? ` ${q('initials')}="${escapeAttribute(short)}"` : ''}>${paragraphs}</${q('comment')}>`
    );
    return id;
  }

  /** Writes the added comments, creating the part (with its relationship
   * and content type) when the document has none. */
  flush() {
    if (this.added.length === 0) return;
    const parts = this.doc.getMap(CONTAINERS.parts);
    const main = mainPart(this.doc);
    const { name, existing, w } = this;
    const comments = this.added.join('');
    if (existing) {
      const close = new RegExp(`</${w}:comments>\\s*$`);
      const updated = close.test(existing)
        ? existing.replace(close, `${comments}</${w}:comments>`)
        : existing.replace(
            new RegExp(`<${w}:comments\\b([^>]*?)\\s*/>`),
            `<${w}:comments$1>${comments}</${w}:comments>`
          );
      parts.set(name, updated);
    } else {
      parts.set(
        name,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="${WORDML_NS}">${comments}</w:comments>`
      );
    }
    this.doc.getMap(CONTAINERS.types).set(`override|${name}`, COMMENTS_TYPE);
    if (!this.related) {
      const rels = this.doc.getMap(CONTAINERS.rels);
      const scope = relsPart(main);
      let id: string;
      do id = `rId${1000 + Math.floor(Math.random() * 1_000_000)}`;
      while (rels.get(`${scope}|${id}`) !== undefined);
      const target = name.slice(directory(main).length);
      rels.set(
        `${scope}|${id}`,
        `<Relationship Id="${id}" Type="${COMMENTS_REL}" Target="${escapeAttribute(target)}"/>`
      );
    }
    this.added.length = 0;
  }
}
