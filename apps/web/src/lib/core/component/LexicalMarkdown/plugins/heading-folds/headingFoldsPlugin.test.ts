import {
  $createHeadingNode,
  HeadingNode,
  type HeadingTagType,
} from '@lexical/rich-text';
import { $setId } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GO_TO_NODE_ID_COMMAND } from '../location/locationPlugin';
import {
  createHeadingFolds,
  FOLDED_BLOCK_CLASS,
  REVEAL_NODE_COMMAND,
} from './headingFoldsPlugin';

const USER = 'user-1';
const DOCUMENT = 'doc-1';

// # A / p1 / ## B / p2 / # C / p3, each block's id equal to its label.
const BLOCKS: [string, HeadingTagType | null][] = [
  ['A', 'h1'],
  ['p1', null],
  ['B', 'h2'],
  ['p2', null],
  ['C', 'h1'],
  ['p3', null],
];

type Mounted = {
  editor: LexicalEditor;
  folds: ReturnType<typeof createHeadingFolds>;
  keys: Record<string, string>;
  dispose: () => void;
};

function mount(): Mounted {
  const editor = createEditor({
    nodes: [HeadingNode],
    onError: (error) => {
      throw error;
    },
  });
  const parent = document.createElement('div');
  const root = document.createElement('div');
  root.contentEditable = 'true';
  parent.append(root);
  document.body.append(parent);
  editor.setRootElement(root);

  const keys: Record<string, string> = {};
  editor.update(
    () => {
      for (const [label, tag] of BLOCKS) {
        const node = tag ? $createHeadingNode(tag) : $createParagraphNode();
        node.append($createTextNode(label));
        $setId(node, label);
        $getRoot().append(node);
        keys[label] = node.getKey();
      }
    },
    { discrete: true }
  );

  const folds = createHeadingFolds({ documentId: DOCUMENT, userId: USER });
  const unregister = folds.plugin(editor);
  return {
    editor,
    folds,
    keys,
    dispose: () => {
      unregister();
      editor.setRootElement(null);
      parent.remove();
    },
  };
}

function hidden({ editor, keys }: Mounted) {
  return Object.keys(keys).filter((label) =>
    editor.getElementByKey(keys[label])?.classList.contains(FOLDED_BLOCK_CLASS)
  );
}

describe('heading folds', () => {
  let mounted: Mounted[] = [];
  const open = () => {
    const m = mount();
    mounted.push(m);
    return m;
  };

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
  });

  afterEach(() => {
    for (const m of mounted) m.dispose();
    mounted = [];
    vi.unstubAllGlobals();
  });

  it('hides a section and shows it again', () => {
    const m = open();
    m.folds.toggle(m.keys.A);
    expect(hidden(m)).toEqual(['p1', 'B', 'p2']);

    m.folds.toggle(m.keys.A);
    expect(hidden(m)).toEqual([]);
  });

  it('restores folds when the document opens again', () => {
    const first = open();
    first.folds.toggle(first.keys.B);
    first.dispose();
    mounted = [];

    const reopened = open();
    expect(hidden(reopened)).toEqual(['p2']);
  });

  it('unfolds every section around a revealed node', () => {
    const m = open();
    m.folds.toggle(m.keys.B);
    m.folds.toggle(m.keys.A);
    expect(hidden(m)).toEqual(['p1', 'B', 'p2']);

    m.editor.dispatchCommand(REVEAL_NODE_COMMAND, m.keys.p2);
    expect(hidden(m)).toEqual([]);
  });

  it('unfolds a section a link points into', () => {
    const m = open();
    m.folds.toggle(m.keys.A);
    m.editor.dispatchCommand(GO_TO_NODE_ID_COMMAND, 'p1');
    expect(hidden(m)).toEqual([]);
  });

  it('moves the caret out of a section it folds', async () => {
    const m = open();
    m.editor.update(
      () => {
        $getRoot().getChildAtIndex(3)?.selectEnd();
      },
      { discrete: true }
    );

    m.folds.toggle(m.keys.B);
    // The caret moves after the fold, in an ordinary (batched) editor update.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(hidden(m)).toEqual(['p2']);
    const anchorTop = m.editor.getEditorState().read(() => {
      const selection = $getSelection();
      return $isRangeSelection(selection)
        ? selection.anchor.getNode().getTopLevelElement()?.getKey()
        : null;
    });
    expect(anchorTop).toBe(m.keys.B);
  });
});
