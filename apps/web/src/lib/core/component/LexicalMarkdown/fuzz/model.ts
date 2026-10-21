/**
 * What a peer's keystrokes should produce, without an editor: the blocks of
 * the peer's own region of the document. Each peer starts in a paragraph that
 * begins with its marker ("Peer A:") and only ever types at the end of its last
 * block, so the model is a list of blocks with the caret at the end of the
 * last one. The rules are Lexical's (and our plugins') for a caret at the end
 * of a block; a disagreement is either a bug or a rule the model is missing.
 */

import { match } from 'ts-pattern';
import type { Random } from './rng';

export type BlockType =
  | 'p'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'quote'
  | 'ul'
  | 'ol'
  | 'code';
export type Block = { type: BlockType; text: string };

export const SHORTCUTS = {
  '# ': 'h1',
  '## ': 'h2',
  '### ': 'h3',
  '> ': 'quote',
  '- ': 'ul',
  '1. ': 'ol',
} as const satisfies Record<string, BlockType>;
type Shortcut = keyof typeof SHORTCUTS;

export type Action =
  | { kind: 'type'; text: string; delay: number }
  | { kind: 'enter' }
  | { kind: 'linebreak' }
  | { kind: 'backspace' }
  | { kind: 'shortcut'; prefix: Shortcut }
  | { kind: 'code' }
  | { kind: 'offline' }
  | { kind: 'online' }
  | { kind: 'pause'; ms: number };

export class PeerModel {
  readonly blocks: Block[];
  online = true;

  constructor(readonly marker: string) {
    this.blocks = [{ type: 'p', text: marker }];
  }

  get current(): Block {
    return this.blocks[this.blocks.length - 1];
  }

  /** A random action that is legal here. */
  generate(random: Random): Action {
    const current = this.current;
    const emptyParagraph = current.type === 'p' && current.text === '';
    const canDelete = !(
      this.blocks.length === 1 && current.text.length <= this.marker.length
    );
    const options: [number, () => Action][] = [
      [
        45,
        () => ({
          kind: 'type',
          text: word(random, current.type === 'code'),
          delay: random.chance(0.8) ? 0 : random.int(25),
        }),
      ],
      [15, () => ({ kind: 'enter' })],
      // Shift+Enter; normalizeEnterPlugin splits instead at an empty line, which the model skips.
      [
        current.type !== 'code' &&
        current.text !== '' &&
        !current.text.endsWith('\n')
          ? 5
          : 0,
        () => ({ kind: 'linebreak' }),
      ],
      [canDelete ? 14 : 0, () => ({ kind: 'backspace' })],
      [
        emptyParagraph ? 12 : 0,
        () => ({
          kind: 'shortcut',
          prefix: random.pick(Object.keys(SHORTCUTS) as Shortcut[]),
        }),
      ],
      [emptyParagraph ? 4 : 0, () => ({ kind: 'code' })],
      [3, () => (this.online ? { kind: 'offline' } : { kind: 'online' })],
      [4, () => ({ kind: 'pause', ms: random.int(60) })],
    ];
    const total = options.reduce((sum, [weight]) => sum + weight, 0);
    let roll = random.next() * total;
    for (const [weight, make] of options) {
      roll -= weight;
      if (roll < 0) return make();
    }
    return options[0][1]();
  }

  apply(action: Action): void {
    const current = this.current;
    match(action)
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
      .with({ kind: 'offline' }, () => {
        this.online = false;
      })
      .with({ kind: 'online' }, () => {
        this.online = true;
      })
      .with({ kind: 'pause' }, () => {})
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
        current.text += `\n${line.match(/^ */)?.[0] ?? ''}`;
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

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

function word(random: Random, code: boolean): string {
  let text = code && random.chance(0.2) ? '  ' : '';
  const length = 1 + random.int(8);
  for (let i = 0; i < length; i++) text += random.pick([...LETTERS]);
  return random.chance(0.5) ? `${text} ` : text;
}
