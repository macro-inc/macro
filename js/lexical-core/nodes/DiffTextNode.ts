import {
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
  TextNode,
} from 'lexical';

export type DiffStatus = 'insert' | 'delete';

export type SerializedDiffTextNode = Spread<
  { diffStatus: DiffStatus; author: string },
  SerializedTextNode
>;

const LANE_HUES = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

export function diffAuthorColor(author: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < author.length; i++) {
    hash ^= author.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `var(--color-accent-${LANE_HUES[(hash >>> 0) % LANE_HUES.length]})`;
}

// Inline diff marker: a TextNode that renders highlighted (insert) or struck
// (delete), tinted by its author's color via a per-node `--diff-author`
export class DiffTextNode extends TextNode {
  __diffStatus: DiffStatus;
  __author: string;

  static getType() {
    return 'diff-text';
  }

  static clone(node: DiffTextNode) {
    return new DiffTextNode(
      node.__text,
      node.__diffStatus,
      node.__author,
      node.__key
    );
  }

  constructor(text: string, status: DiffStatus, author: string, key?: NodeKey) {
    super(text, key);
    this.__diffStatus = status;
    this.__author = author;
  }

  createDOM(config: EditorConfig) {
    const dom = super.createDOM(config);
    dom.classList.add(`diff-${this.__diffStatus}`);
    // Expose status + author on the element so a single delegated hover handler
    // (see HistoryOverlay) can show a "who changed this" tag, matching the
    // timeline scrubber. The author is a user id, resolved to a label at hover.
    dom.dataset.diffStatus = this.__diffStatus;
    if (this.__author) {
      dom.dataset.diffAuthor = this.__author;
      // Tint this run by its own editor, overriding the container default.
      dom.style.setProperty('--diff-author', diffAuthorColor(this.__author));
    }
    return dom;
  }

  updateDOM(prev: DiffTextNode, dom: HTMLElement, config: EditorConfig) {
    const updated = super.updateDOM(prev, dom, config);
    return (
      updated ||
      prev.__diffStatus !== this.__diffStatus ||
      prev.__author !== this.__author
    );
  }

  static importJSON(serialized: SerializedDiffTextNode): DiffTextNode {
    const node = new DiffTextNode(
      serialized.text,
      serialized.diffStatus,
      serialized.author
    );
    node.setFormat(serialized.format);
    node.setDetail(serialized.detail);
    node.setMode(serialized.mode);
    node.setStyle(serialized.style);
    return node;
  }

  exportJSON(): SerializedDiffTextNode {
    return {
      ...super.exportJSON(),
      type: DiffTextNode.getType(),
      diffStatus: this.__diffStatus,
      author: this.__author,
    };
  }
}

export function $createDiffTextNode(
  text: string,
  status: DiffStatus,
  author: string
): DiffTextNode {
  return new DiffTextNode(text, status, author);
}

export function $isDiffTextNode(
  node: LexicalNode | null
): node is DiffTextNode {
  return node instanceof DiffTextNode;
}
