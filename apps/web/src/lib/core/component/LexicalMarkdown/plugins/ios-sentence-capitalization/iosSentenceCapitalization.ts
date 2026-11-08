import { type EditorConfig, IS_IOS, TextNode } from 'lexical';

/**
 * iOS decides whether the next letter is capitalized from the keyboard's
 * sentence state. Lexical publishes each keystroke by assigning the text
 * node's whole value, and WebKit treats that as a new field: the sentence
 * state is dropped and rebuilt on a later pass. A letter typed before that
 * pass stays lowercase. Deleting it and typing again works, because the
 * pause gives the keyboard time to catch up.
 *
 * An insertion through `insertData` keeps the same text node and the
 * keyboard state. Replacements still go through the value assignment, which
 * is what clears a spellcheck underline after a correction.
 */
let restoreUpdateDOM: (() => void) | null = null;

export function installIosSentenceCapitalization(enabled = IS_IOS): () => void {
  if (!enabled) return () => {};
  if (restoreUpdateDOM) return restoreUpdateDOM;

  const originalUpdateDOM = TextNode.prototype.updateDOM;
  TextNode.prototype.updateDOM = function updateDOM(
    this: TextNode,
    prevNode: TextNode,
    dom: HTMLElement,
    config: EditorConfig
  ) {
    if (!this.isComposing()) writePureInsertion(dom, this.getTextContent());
    return originalUpdateDOM.call(this, prevNode, dom, config);
  };

  restoreUpdateDOM = () => {
    TextNode.prototype.updateDOM = originalUpdateDOM;
    restoreUpdateDOM = null;
  };
  return restoreUpdateDOM;
}

function writePureInsertion(dom: HTMLElement, nextText: string) {
  const text = lexicalTextChild(dom);
  if (!text) return;
  const current = text.data;
  if (current === nextText) return;
  const inserted = pureInsertion(current, nextText);
  if (!inserted) return;
  text.insertData(inserted.index, inserted.text);
}

/**
 * The single text child Lexical writes into. A split text node is left alone:
 * inserting into the first piece would repeat whatever follows it.
 */
function lexicalTextChild(dom: HTMLElement): Text | null {
  const first = dom.firstChild;
  if (first instanceof Text) {
    return first.nextSibling === null ? first : null;
  }
  if (
    first instanceof HTMLElement &&
    first.nextSibling === null &&
    first.firstChild instanceof Text &&
    first.firstChild.nextSibling === null
  ) {
    return first.firstChild;
  }
  return null;
}

/**
 * A change that only inserts characters. Offsets are UTF-16, matching
 * `CharacterData.insertData`.
 */
function pureInsertion(
  current: string,
  next: string
): { index: number; text: string } | null {
  if (next.length <= current.length) return null;
  let index = 0;
  while (index < current.length && current[index] === next[index]) index++;
  const suffix = current.slice(index);
  if (!next.endsWith(suffix)) return null;
  const text = next.slice(index, next.length - suffix.length);
  if (!text) return null;
  return { index, text };
}
