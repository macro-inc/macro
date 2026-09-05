/**
 * Turn a missed substring match into an actionable error.
 *
 * `replace`, `bold`, `italic`, `inlineCode`, `link` and friends all locate their
 * target by substring. Their engines return a match count, every caller
 * discarded it, and a miss therefore applied nothing and reported success. Those
 * four methods alone account for ~2,600 calls across the 495-session prod
 * corpus, and a silent miss is indistinguishable from a completed edit.
 *
 * The observed consequence is the coder guessing. One session spent six calls
 * trying to fix a total in a bold run, narrowing from a substring to the node's
 * entire text, getting no error each time:
 *
 *   editor.replace('_UgddKRe', '408', '414.8')                      -> nothing
 *   editor.replace('_UgddKRe', '/ 408 с НДС', '/ 414.8 с НДС')      -> nothing
 *   editor.replace('_UgddKRe', '<the whole sentence>', '...')       -> nothing
 *
 * The needle straddled a text-node boundary, and the matchers work per text
 * node. Nothing in the reply could have told the coder that, so it kept trying
 * different phrasings of a call that could never work.
 *
 * The error names the node, the needle, and the block's actual per-text-node
 * content — which is what makes the boundary visible.
 */

import type { ElementNode } from 'lexical';

/** How much of the block's text to quote back. Enough to spot the problem
 *  without pasting a whole document into the coder's context. */
const MAX_QUOTED = 400;

function clip(text: string): string {
  return text.length <= MAX_QUOTED
    ? text
    : `${text.slice(0, MAX_QUOTED)}… (+${text.length - MAX_QUOTED} chars)`;
}

/**
 * Throw if `count` is zero, explaining why the needle could not be found.
 *
 * Distinguishes the two real causes:
 *   - the text simply isn't there, versus
 *   - the text IS there but split across text nodes, so no single node holds it.
 */
export function assertSubstringMatched(
  count: number,
  block: ElementNode,
  label: string,
  operation: string,
  needle: string
): void {
  if (count > 0) return;

  const full = block.getTextContent();
  const runs = block.getAllTextNodes().map((tn) => tn.getTextContent());

  if (full.includes(needle)) {
    throw new Error(
      `${operation}: "${needle}" appears in "${label}" but is SPLIT ACROSS separate text runs, ` +
        `so no single run contains it — substring matching works per run. ` +
        `The runs are: ${runs.map((r) => JSON.stringify(r)).join(' + ')}. ` +
        `Target a substring that sits inside ONE run, or replace the whole block's text with setText.`
    );
  }

  throw new Error(
    `${operation}: "${needle}" does not occur in "${label}". ` +
      `Its text is ${JSON.stringify(clip(full))}. ` +
      `Match a substring that is actually present (mind punctuation, casing and whitespace).`
  );
}
