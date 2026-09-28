import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  if (typeof globalThis.Worker === 'undefined') {
    (globalThis as any).Worker = class FakeWorker {
      onmessage = null;
      postMessage() {}
      terminate() {}
      addEventListener() {}
      removeEventListener() {}
    };
  }
});

// Stub any imports before they import the entire app (sad).
vi.mock('@core/constant/allBlocks', () => ({
  verifyBlockName: (name: string) => name,
}));
vi.mock('@core/signal/mention', () => ({
  untrackMention: vi.fn(),
}));
vi.mock('@service-storage/client', () => ({
  blockNameToItemType: (name: string) => name,
}));
vi.mock('../utils', async () => {
  const { $getNodeByKey } = await import('lexical');
  return {
    $collapseSelection: vi.fn(),
    $traverseNodes: vi.fn(),
    nodeByKey: (editorOrState: any, key: string) => {
      let node: any;
      editorOrState.read(() => {
        node = $getNodeByKey(key);
      });
      return node;
    },
  };
});
vi.mock('../plugins/shared', () => ({
  mapRegisterDelete: () => () => {},
}));

import { SupportedNodeTypes } from '@macro-inc/lexical-core/node-list';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  type LexicalEditor,
  type TextNode,
} from 'lexical';
import { createSignal } from 'solid-js';
import {
  INSERT_USER_MENTION_COMMAND,
  mentionsPlugin,
  REMOVE_INLINE_SEARCH_COMMAND,
} from '../plugins/mentions/mentionsPlugin';
import type { MenuOperations } from '../shared/inlineMenu';

type Harness = {
  editor: LexicalEditor;
  /** Types `text` the way a keyboard would: keydown first, then the character. */
  type: (text: string) => void;
  /** `type:"text"` for every child of the first paragraph. */
  children: () => string[];
  searchTerms: string[];
  opened: () => number;
};

let cleanups: Array<() => void> = [];

beforeEach(() => {
  cleanups = [];
  return () => {
    for (const cleanup of cleanups) cleanup();
    document.body.innerHTML = '';
  };
});

function setup(withParagraph: (text: typeof $createTextNode) => void): Harness {
  const editor = createEditor({
    namespace: 'mention-trigger-test',
    nodes: [...SupportedNodeTypes],
    onError: (e) => {
      throw e;
    },
  });

  const rootElement = document.createElement('div');
  rootElement.contentEditable = 'true';
  document.body.appendChild(rootElement);
  editor.setRootElement(rootElement);

  const [isOpen, setIsOpen] = createSignal(false);
  const [searchTerm, setSearchTerm] = createSignal('');
  const searchTerms: string[] = [];
  let openCount = 0;
  const menu: MenuOperations = {
    openMenu: () => {
      openCount += 1;
      setIsOpen(true);
    },
    closeMenu: () => setIsOpen(false),
    searchTerm,
    setSearchTerm: (term) => {
      searchTerms.push(term);
      setSearchTerm(term);
    },
    isOpen,
    setIsOpen,
  };

  cleanups.push(mentionsPlugin({ menu })(editor));

  editor.update(() => withParagraph($createTextNode), { discrete: true });
  editor.read(() => {});

  const type = (text: string) => {
    for (const character of text) {
      rootElement.dispatchEvent(
        new KeyboardEvent('keydown', { key: character, bubbles: true })
      );
      editor.read(() => {});
      editor.update(
        () => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) selection.insertText(character);
        },
        { discrete: true }
      );
      editor.read(() => {});
    }
  };

  return {
    editor,
    type,
    children: () =>
      editor.getEditorState().read(() =>
        $getRoot()
          .getChildren()
          .flatMap((block) =>
            'getChildren' in block
              ? (block as any)
                  .getChildren()
                  .map(
                    (node: any) => `${node.getType()}:${node.getTextContent()}`
                  )
              : []
          )
      ),
    searchTerms,
    opened: () => openCount,
  };
}

/** A paragraph holding `text`, with the caret placed at `offset`. */
function paragraphWithCaret(text: string, offset: number) {
  return (createText: (text: string) => TextNode) => {
    const paragraph = $createParagraphNode();
    const node = createText(text);
    paragraph.append(node);
    $getRoot().clear().append(paragraph);
    node.select(offset, offset);
  };
}

describe('@ trigger position', () => {
  test('opens a blank menu at the start of a word, leaving the word alone', () => {
    const harness = setup(paragraphWithCaret('hello world', 6));

    harness.type('@');

    expect(harness.opened()).toBe(1);
    expect(harness.searchTerms.at(-1)).toBe('');
    expect(harness.children()).toEqual([
      'text:hello ',
      'inline-search:@',
      'text:world',
    ]);
  });

  test('searches only what is typed after the @, not the following word', () => {
    const harness = setup(paragraphWithCaret('hello world', 6));

    harness.type('@jo');

    expect(harness.searchTerms.at(-1)).toBe('jo');
    expect(harness.children()).toEqual([
      'text:hello ',
      'inline-search:@jo',
      'text:world',
    ]);
  });

  test('inserts the chosen mention before the untouched following word', () => {
    const harness = setup(paragraphWithCaret('hello world', 6));

    harness.type('@jo');
    harness.editor.dispatchCommand(REMOVE_INLINE_SEARCH_COMMAND, undefined);
    harness.editor.read(() => {});
    harness.editor.dispatchCommand(INSERT_USER_MENTION_COMMAND, {
      userId: 'user-1',
      email: 'jo@macro.com',
      displayName: 'Jo',
    });
    harness.editor.read(() => {});

    expect(harness.children()).toEqual([
      'text:hello ',
      'user-mention:Jo',
      'text:world',
    ]);
  });

  test('stays a literal @ in the middle of a word', () => {
    const harness = setup(paragraphWithCaret('hello world', 3));

    harness.type('@');

    expect(harness.opened()).toBe(0);
    expect(harness.children()).toEqual(['text:hel@lo world']);
  });

  test('stays a literal @ mid-word across a formatting boundary', () => {
    const harness = setup((createText) => {
      const paragraph = $createParagraphNode();
      const bold = createText('bo');
      bold.toggleFormat('bold');
      const rest = createText('ld');
      paragraph.append(bold, rest);
      $getRoot().clear().append(paragraph);
      rest.select(0, 0);
    });

    harness.type('@');

    expect(harness.opened()).toBe(0);
    expect(harness.children().join('')).not.toContain('inline-search');
  });

  test('opens the menu after a trailing space', () => {
    const harness = setup(paragraphWithCaret('hello ', 6));

    harness.type('@');

    expect(harness.opened()).toBe(1);
    expect(harness.children()).toEqual(['text:hello ', 'inline-search:@']);
  });

  test('opens the menu at the start of an empty paragraph', () => {
    const harness = setup(() => {
      const paragraph = $createParagraphNode();
      $getRoot().clear().append(paragraph);
      paragraph.select();
    });

    harness.type('@');

    expect(harness.opened()).toBe(1);
    expect(harness.children()).toEqual(['inline-search:@']);
  });
});
