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
vi.mock('@core/constant/featureFlags', () => ({
  enableSnippets: {},
  isFeatureEnabled: () => true,
}));
vi.mock('../context/LexicalWrapperContext', async () => {
  const { createEditor } = await import('lexical');
  return {
    createLexicalWrapper: () => ({ editor: createEditor(), cleanup: vi.fn() }),
  };
});
vi.mock('../utils', async () => {
  const { $getNodeByKey } = await import('lexical');
  return {
    $collapseSelection: vi.fn(),
    $traverseNodes: vi.fn(),
    editorStateAsMarkdown: vi.fn(),
    initializeEditorWithState: vi.fn(),
    setEditorStateFromMarkdown: vi.fn(),
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
import { actionsPlugin } from '../plugins/actions/actionsPlugin';
import { emojisPlugin } from '../plugins/emojis/emojisPlugin';
import {
  INSERT_USER_MENTION_COMMAND,
  mentionsPlugin,
  REMOVE_INLINE_SEARCH_COMMAND,
} from '../plugins/mentions/mentionsPlugin';
import { skillsPlugin } from '../plugins/skills/skillsPlugin';
import { snippetsPlugin } from '../plugins/snippets/snippetsPlugin';
import { tagsPlugin } from '../plugins/tags/tagsPlugin';
import type { MenuOperations } from '../shared/inlineMenu';

type Harness = {
  editor: LexicalEditor;
  /** Sends keydown and beforeinput, then inserts the character. */
  type: (text: string, softwareKeyboard?: boolean) => void;
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

function setup(
  withParagraph: (text: typeof $createTextNode) => void,
  plugin: (props: {
    menu: MenuOperations;
  }) => (editor: LexicalEditor) => () => void = mentionsPlugin
): Harness {
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

  cleanups.push(plugin({ menu })(editor));

  editor.update(() => withParagraph($createTextNode), { discrete: true });
  editor.read(() => {});

  const type = (text: string, softwareKeyboard = false) => {
    for (const character of text) {
      rootElement.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: softwareKeyboard ? 'Unidentified' : character,
          keyCode: softwareKeyboard ? 229 : 0,
          bubbles: true,
        })
      );
      editor.read(() => {});
      rootElement.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: character,
          bubbles: true,
          cancelable: true,
        })
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
  test('opens and filters from software-keyboard input without an @ keydown', () => {
    const harness = setup(paragraphWithCaret('hello ', 6));

    harness.type('@jo', true);

    expect(harness.opened()).toBe(1);
    expect(harness.searchTerms.at(-1)).toBe('jo');
    expect(harness.children()).toEqual(['text:hello ', 'inline-search:@jo']);
  });

  test('keeps software-keyboard @ literal inside a word', () => {
    const harness = setup(paragraphWithCaret('hello', 3));

    harness.type('@', true);

    expect(harness.opened()).toBe(0);
    expect(harness.children()).toEqual(['text:hel@lo']);
  });

  test('opens from software input in an empty paragraph', () => {
    const harness = setup(() => {
      const paragraph = $createParagraphNode();
      $getRoot().clear().append(paragraph);
      paragraph.select();
    });

    harness.type('@', true);

    expect(harness.opened()).toBe(1);
    expect(harness.children()).toEqual(['inline-search:@']);
  });

  test.each([
    { inputType: 'insertFromPaste', isComposing: false },
    { inputType: 'insertCompositionText', isComposing: true },
    { inputType: 'insertText', isComposing: true },
  ])('does not intercept $inputType (composing: $isComposing)', (input) => {
    const harness = setup(paragraphWithCaret('hello ', 6));

    harness.editor.getRootElement()!.dispatchEvent(
      new InputEvent('beforeinput', {
        ...input,
        data: '@',
        bubbles: true,
        cancelable: true,
      })
    );
    harness.editor.read(() => {});

    expect(harness.opened()).toBe(0);
    expect(harness.children()).toEqual(['text:hello ']);
  });

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

describe.each([
  { name: 'emoji', symbol: ':', plugin: emojisPlugin },
  { name: 'actions', symbol: '/', plugin: actionsPlugin },
  { name: 'skills', symbol: '/', plugin: skillsPlugin },
  { name: 'snippets', symbol: ';', plugin: snippetsPlugin },
  { name: 'tags', symbol: '#', plugin: tagsPlugin },
])('$name menu input', ({ symbol, plugin }) => {
  test.each([true, false])(
    'opens once and filters (software keyboard: %s)',
    (softwareKeyboard) => {
      const harness = setup(paragraphWithCaret('hello ', 6), plugin);

      harness.type(`${symbol}test`, softwareKeyboard);

      expect(harness.opened()).toBe(1);
      expect(harness.searchTerms.at(-1)).toBe('test');
      expect(harness.children()).toEqual([
        'text:hello ',
        `inline-search:${symbol}test`,
      ]);
    }
  );

  test('keeps the software-keyboard trigger literal inside a word', () => {
    const harness = setup(paragraphWithCaret('hello', 3), plugin);

    harness.type(symbol, true);

    expect(harness.opened()).toBe(0);
    expect(harness.children()).toEqual([`text:hel${symbol}lo`]);
  });
});

test.each([true, false])(
  'a second # closes the tags menu (software keyboard: %s)',
  (softwareKeyboard) => {
    const harness = setup(paragraphWithCaret('hello ', 6), tagsPlugin);

    harness.type('##', softwareKeyboard);

    expect(harness.opened()).toBe(1);
    expect(harness.children()).toEqual(['text:hello ##']);
  }
);
