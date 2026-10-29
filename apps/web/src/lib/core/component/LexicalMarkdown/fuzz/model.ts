/**
 * What a peer's keystrokes should produce, without an editor: the blocks of
 * the peer's own region of the document. Each peer starts in a paragraph that
 * begins with its marker ("Peer A:") and only ever types at the end of its last
 * block, so the model is a list of blocks with the caret at the end of the
 * last one. The rules are Lexical's (and our plugins') for a caret at the end
 * of a block; a disagreement is either a bug or a rule the model is missing.
 */

import { match } from 'ts-pattern';

type BlockType = 'p' | 'h1' | 'h2' | 'h3' | 'quote' | 'ul' | 'ol' | 'code';
export type Block = { type: BlockType; text: string };

export const SHORTCUT_PREFIXES = [
  '# ',
  '## ',
  '### ',
  '> ',
  '- ',
  '1. ',
] as const;
type Shortcut = (typeof SHORTCUT_PREFIXES)[number];

/** The block each markdown shortcut turns an empty paragraph into. */
const SHORTCUTS: Record<Shortcut, BlockType> = {
  '# ': 'h1',
  '## ': 'h2',
  '### ': 'h3',
  '> ': 'quote',
  '- ': 'ul',
  '1. ': 'ol',
};

/** One thing a person does at the keyboard. */
export type Key =
  | { kind: 'type'; text: string; delay: number }
  | { kind: 'enter' }
  | { kind: 'linebreak' }
  | { kind: 'backspace' }
  | { kind: 'shortcut'; prefix: Shortcut }
  | { kind: 'code' };

export class PeerModel {
  readonly blocks: Block[];
  online = true;
  /** Keys pressed, for the undo phase's step budget. */
  keys = 0;

  constructor(readonly marker: string) {
    this.blocks = [{ type: 'p', text: marker }];
  }

  get current(): Block {
    const last = this.blocks.at(-1);
    if (!last) throw new Error(`${this.marker} region has no blocks`);
    return last;
  }

  /** Whether the model knows what `key` does here. */
  allows(key: Key): boolean {
    const current = this.current;
    const emptyParagraph = current.type === 'p' && current.text === '';
    return (
      match(key)
        .with(
          { kind: 'type' },
          ({ text }) => current.type === 'code' || !text.startsWith(' ')
        )
        .with({ kind: 'enter' }, () => true)
        // normalizeEnterPlugin splits instead at an empty line, which the model skips.
        .with(
          { kind: 'linebreak' },
          () =>
            current.type !== 'code' &&
            current.text !== '' &&
            !current.text.endsWith('\n')
        )
        .with(
          { kind: 'backspace' },
          () =>
            this.blocks.length > 1 || current.text.length > this.marker.length
        )
        .with({ kind: 'shortcut' }, { kind: 'code' }, () => emptyParagraph)
        .exhaustive()
    );
  }

  apply(key: Key): void {
    this.keys++;
    const current = this.current;
    match(key)
      .with({ kind: 'type' }, ({ text }) => {
        current.text += text;
      })
      .with({ kind: 'shortcut' }, ({ prefix }) => {
        current.type = SHORTCUTS[prefix];
      })
      .with({ kind: 'code' }, () => {
        current.type = 'code';
      })
      .with({ kind: 'enter' }, () => this.enter())
      .with({ kind: 'linebreak' }, () => {
        current.text += '\n';
      })
      .with({ kind: 'backspace' }, () => {
        if (current.text !== '') current.text = current.text.slice(0, -1);
        // An empty list item becomes a paragraph (customDeletePlugin); any
        // other empty block merges into the block before it.
        else if (current.type === 'ul' || current.type === 'ol')
          current.type = 'p';
        else this.blocks.pop();
      })
      .exhaustive();
  }

  private enter(): void {
    const current = this.current;
    if (current.type === 'code') {
      // Two empty lines at the end leave the block ($exitCodeNodeOnEnter);
      // otherwise the new line keeps the current line's indentation.
      if (current.text.endsWith('\n\n')) {
        current.text = current.text.slice(0, -2);
        this.blocks.push({ type: 'p', text: '' });
      } else {
        const line = current.text.slice(current.text.lastIndexOf('\n') + 1);
        const indentation = line.length - line.trimStart().length;
        current.text += `\n${' '.repeat(indentation)}`;
      }
    } else if (current.type !== 'p' && current.text === '') {
      // Lists exit, and normalizeEnterPlugin turns an empty heading or quote
      // back into a paragraph.
      current.type = 'p';
    } else if (current.type === 'ul' || current.type === 'ol') {
      this.blocks.push({ type: current.type, text: '' });
    } else {
      this.blocks.push({ type: 'p', text: '' });
    }
  }
}
