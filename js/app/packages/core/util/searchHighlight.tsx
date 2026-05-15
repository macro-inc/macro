/**
 * Utilities for extracting information from search highlight content
 * that contains <macro_em> tags marking matched terms.
 */
import { For } from 'solid-js';

const INVISIBLE_CHARS_RE =
  /(?:[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\u00AD\u2800-\u28FF]|\u034F)+/g;
const MACRO_EM_SPLIT_RE = /(<macro_em>.*?<\/macro_em>)/gs;
const MACRO_EM_UNWRAP_RE = /^<macro_em>(.*)<\/macro_em>$/s;

/** Collapses newlines, extra whitespace, and invisible Unicode characters into a clean single line. */
function stripInvisibleChars(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(INVISIBLE_CHARS_RE, '')
    .trim();
}

/** Returns the visible character count after stripping invisible chars and `<macro_em>` tags. */
export function visibleLength(content: string): number {
  return stripInvisibleChars(content)
    .replace(/<\/?macro_em>/g, '')
    .trim().length;
}

/**
 * Extracts terms from macro_em tags in the highlighted content.
 * Returns array of text strings that should be highlighted, preserving order and duplicates.
 *
 * @param highlightedContent - Content with <macro_em> tags marking matches
 * @returns Array of matched terms
 *
 * @example
 * extractSearchTerms("The <macro_em>quick</macro_em> brown <macro_em>fox</macro_em>")
 * // Returns: ["quick", "fox"]
 */
export function extractSearchTerms(highlightedContent: string): string[] {
  const terms: string[] = [];
  const macroEmRegex = /<macro_em>(.*?)<\/macro_em>/gs;
  const matches = Array.from(highlightedContent.matchAll(macroEmRegex));

  for (const match of matches) {
    terms.push(match[1].trim());
  }

  return terms;
}

/**
 * Extracts the full snippet from highlighted content by removing macro_em tags.
 * Whitespace is normalized and trimmed.
 * This provides context for the search result.
 *
 * @param highlightedContent - Content with <macro_em> tags marking matches
 * @returns Clean text snippet with normalized whitespace
 *
 * @example
 * extractSearchSnippet("The <macro_em>quick</macro_em>\n  brown   fox")
 * // Returns: "The quick brown fox"
 */
export function extractSearchSnippet(highlightedContent: string): string {
  const rawContent = highlightedContent.replace(/<\/?macro_em>/g, '');
  return rawContent.replace(/\s+/g, ' ').trim();
}

/**
 * Merges adjacent macro_em tags in highlighted content.
 * When multiple macro_em tags appear consecutively (with only whitespace between them),
 * they are merged into a single macro_em tag.
 *
 * @param highlightedContent - Content with <macro_em> tags marking matches
 * @returns Content with adjacent macro_em tags merged
 *
 * @example
 * mergeAdjacentMacroEmTags("The <macro_em>quick</macro_em> <macro_em>brown</macro_em> fox")
 * // Returns: "The <macro_em>quick brown</macro_em> fox"
 *
 * @example
 * mergeAdjacentMacroEmTags("<macro_em>Hello</macro_em> <macro_em>world</macro_em>, <macro_em>goodbye</macro_em>")
 * // Returns: "<macro_em>Hello world</macro_em>, <macro_em>goodbye</macro_em>"
 */
export function mergeAdjacentMacroEmTags(highlightedContent: string): string {
  return highlightedContent.replace(/<\/macro_em>(\s+)<macro_em>/g, '$1');
}

/** Escapes regex special characters in a string. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a case-insensitive global RegExp that matches any of the given
 * terms as a single capture group. Returns `undefined` if `terms` is empty.
 */
export function buildTermsPattern(
  terms: readonly string[]
): RegExp | undefined {
  if (terms.length === 0) return undefined;
  return new RegExp(`(${terms.map(escapeRegex).join('|')})`, 'gi');
}

/** Wraps each occurrence of the given terms in `<macro_em>` tags (case-insensitive). */
export function highlightTermsInText(text: string, terms: string[]): string {
  const pattern = buildTermsPattern(terms);
  if (!pattern) return text;
  return text.replace(pattern, '<macro_em>$1</macro_em>');
}

/**
 * Default attribute used to mark DOM highlight wrappers. The DOM helpers
 * below use this to find and unwrap their own injected spans on the next
 * pass without disturbing other spans in the subtree.
 */
const DOM_HIGHLIGHT_MARKER_ATTR = 'data-search-highlight';
const DOM_HIGHLIGHT_DEFAULT_CLASS = 'md-mark search-match inline';

type DomHighlightOptions = {
  /** CSS classes applied to the injected `<span>` wrapper. */
  className?: string;
  /** Marker attribute name (used to find wrappers on cleanup). */
  markerAttr?: string;
};

/**
 * Removes previously-injected highlight spans from `root` (those carrying
 * the marker attribute). Adjacent text nodes are merged via `normalize()`.
 */
export function unwrapDomHighlights(
  root: HTMLElement,
  options: DomHighlightOptions = {}
): void {
  const markerAttr = options.markerAttr ?? DOM_HIGHLIGHT_MARKER_ATTR;
  const spans = root.querySelectorAll<HTMLElement>(`span[${markerAttr}]`);
  if (spans.length === 0) return;
  spans.forEach((s) => {
    const text = s.ownerDocument.createTextNode(s.textContent ?? '');
    s.parentNode?.replaceChild(text, s);
  });
  root.normalize();
}

/**
 * Walks text nodes under `root` and wraps occurrences of `terms` (case-
 * insensitive) in `<span>` elements carrying the marker attribute and CSS
 * classes. Pure DOM mutation — does not touch any component tree, so it's
 * safe to use when the rendered subtree is expensive to rebuild.
 *
 * Text nodes inside existing highlight wrappers are skipped so re-applying
 * is idempotent when paired with {@link unwrapDomHighlights}.
 */
export function applyDomHighlights(
  root: HTMLElement,
  terms: readonly string[],
  options: DomHighlightOptions = {}
): void {
  const pattern = buildTermsPattern(terms);
  if (!pattern) return;

  const markerAttr = options.markerAttr ?? DOM_HIGHLIGHT_MARKER_ATTR;
  const className = options.className ?? DOM_HIGHLIGHT_DEFAULT_CLASS;

  const targets: Text[] = [];
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (parent?.hasAttribute(markerAttr)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );
  while (true) {
    const n = walker.nextNode();
    if (!n) break;
    targets.push(n as Text);
  }

  for (const tn of targets) {
    const text = tn.nodeValue ?? '';
    pattern.lastIndex = 0;
    if (!pattern.test(text)) continue;
    pattern.lastIndex = 0;

    const doc = tn.ownerDocument;
    const frag = doc.createDocumentFragment();
    let lastIdx = 0;
    for (const m of text.matchAll(pattern)) {
      if (m.index > lastIdx) {
        frag.appendChild(doc.createTextNode(text.slice(lastIdx, m.index)));
      }
      const span = doc.createElement('span');
      span.className = className;
      span.setAttribute(markerAttr, '1');
      span.textContent = m[0];
      frag.appendChild(span);
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < text.length) {
      frag.appendChild(doc.createTextNode(text.slice(lastIdx)));
    }
    tn.parentNode?.replaceChild(frag, tn);
  }
}

/**
 * Creates a single-line window around the first <macro_em> highlight.
 * - Collapses newlines and invisible chars into a clean single line
 * - If the highlight is within `chars` of the start, keeps the start
 * - Otherwise, trims the front to show context before the highlight
 * - Trims the end to keep total visible length reasonable
 *
 * @param text - Content with <macro_em> tags
 * @param chars - Max visible characters to show on each side of the highlight
 */
export function windowSearchMatch(text: string, chars: number): string {
  let line = stripInvisibleChars(text);

  const macroOpen = '<macro_em>';
  const macroClose = '</macro_em>';
  const tagIndex = line.indexOf(macroOpen);
  if (tagIndex === -1) return line;

  const lastCloseIndex = line.lastIndexOf(macroClose);

  const visibleBefore = line
    .slice(0, tagIndex)
    .replace(/<\/?macro_em>/g, '').length;
  const visibleAfter =
    lastCloseIndex === -1
      ? 0
      : line
          .slice(lastCloseIndex + macroClose.length)
          .replace(/<\/?macro_em>/g, '').length;
  const visibleMatch =
    lastCloseIndex === -1
      ? 0
      : line
          .slice(tagIndex, lastCloseIndex + macroClose.length)
          .replace(/<\/?macro_em>/g, '').length;

  const totalBudget = Math.max(0, chars * 2 - visibleMatch);
  const frontKeep = Math.max(chars, totalBudget - visibleAfter);
  const backKeep = Math.max(chars, totalBudget - visibleBefore);

  // Trim from front if highlight is far from the start
  if (visibleBefore > frontKeep) {
    const targetStart = Math.max(0, tagIndex - frontKeep);
    let cutIndex = targetStart;
    for (let i = targetStart; i < tagIndex; i++) {
      if (/\s/.test(line[i])) {
        cutIndex = i + 1;
        break;
      }
    }
    line = line.slice(cutIndex);
  }

  // Trim from end to keep total length reasonable
  const finalCloseIndex = line.lastIndexOf(macroClose);
  if (finalCloseIndex !== -1) {
    const afterLastTag = finalCloseIndex + macroClose.length;
    const remainingVisible = line
      .slice(afterLastTag)
      .replace(/<\/?macro_em>/g, '').length;
    if (remainingVisible > backKeep) {
      let endCut = afterLastTag + backKeep;
      for (let i = endCut; i < line.length; i++) {
        if (/\s/.test(line[i])) {
          endCut = i;
          break;
        }
      }
      line = line.slice(0, endCut);
    }
  }

  return line;
}

/**
 * Parses text containing `<macro_em>` tags into an array of segments.
 * Each segment is either plain text or a highlighted match.
 */
export function parseSearchHighlightSegments(
  text: string
): Array<{ text: string; highlight: boolean }> {
  const parts = text.split(MACRO_EM_SPLIT_RE);
  const segments: Array<{ text: string; highlight: boolean }> = [];
  for (const part of parts) {
    if (!part) continue;
    const match = MACRO_EM_UNWRAP_RE.exec(part);
    if (match) {
      segments.push({ text: match[1], highlight: true });
    } else {
      segments.push({ text: part, highlight: false });
    }
  }
  return segments;
}

export function HighlightRender(props: { text: string }) {
  return (
    <span>
      <For each={parseSearchHighlightSegments(props.text)}>
        {(segment) =>
          segment.highlight ? (
            <span class="md-mark search-match">{segment.text}</span>
          ) : (
            segment.text
          )
        }
      </For>
    </span>
  );
}
