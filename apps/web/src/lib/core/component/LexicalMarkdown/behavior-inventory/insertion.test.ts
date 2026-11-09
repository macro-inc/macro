import {
  $createListItemNode,
  $createListNode,
  $isListNode,
} from '@lexical/list';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  DELETE_CHARACTER_COMMAND,
  DELETE_LINE_COMMAND,
  DELETE_WORD_COMMAND,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import {
  awaitPlugin,
  INSERT_AWAIT_NODE_COMMAND,
  REPLACE_AWAIT_NODE_COMMAND,
} from '../plugins/await/awaitPlugin';
import { customDeletePlugin } from '../plugins/custom-delete/customDeletePlugin';
import {
  INSERT_TEXT_COMMAND,
  insertTextPlugin,
} from '../plugins/insert-text/insertTextPlugin';
import { singleLinePlugin } from '../plugins/single-line/singleLinePlugin';
import { behaviorEditor } from './editor';

describe('single-line title normalization', () => {
  it('retains only the first root block', () => {
    const { editor, root } = behaviorEditor(singleLinePlugin());
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode('first')),
          $createParagraphNode().append($createTextNode('second')),
          $createParagraphNode().append($createTextNode('third'))
        );
      },
      { discrete: true }
    );
    expect(root.textContent).toBe('first');
    expect(root.children).toHaveLength(1);
  });

  it('removes pasted line breaks without losing inline text', () => {
    const { editor, root } = behaviorEditor(singleLinePlugin());
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(
            $createTextNode('before'),
            $createLineBreakNode(),
            $createTextNode('after')
          )
        );
      },
      { discrete: true }
    );
    expect(root.textContent).toBe('beforeafter');
    expect(root.querySelector('br')).toBeNull();
  });

  it('unwraps nested snippet paragraphs while preserving inline formatting', () => {
    const { editor, root } = behaviorEditor(singleLinePlugin());
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(
            $createTextNode('before '),
            $createParagraphNode().append(
              $createTextNode('bold').toggleFormat('bold')
            ),
            $createTextNode(' after')
          )
        );
      },
      { discrete: true }
    );
    expect(root.textContent).toBe('before bold after');
    expect(root.querySelectorAll('p')).toHaveLength(1);
    expect(root.querySelector('strong')?.textContent).toBe('bold');
  });
});

describe('insert text command', () => {
  it.each(['plain text', 'emoji 😀', 'line one\nline two', ''])(
    'inserts %j at a root selection',
    (value) => {
      const { editor } = behaviorEditor(insertTextPlugin());
      editor.update(
        () => {
          $getRoot().selectEnd();
          expect(editor.dispatchCommand(INSERT_TEXT_COMMAND, value)).toBe(true);
        },
        { discrete: true }
      );
      editor.read(() => {
        expect($getRoot().getFirstChild()?.getType()).toBe('paragraph');
        expect($getRoot().getTextContent()).toBe(value);
        const selection = $getSelection();
        expect($isRangeSelection(selection)).toBe(true);
        if (!$isRangeSelection(selection))
          throw new Error('Expected text caret');
        expect(selection.isCollapsed()).toBe(true);
        expect(selection.anchor.offset).toBe(value.length);
      });
    }
  );

  it('replaces selected text and leaves the caret after the insertion', () => {
    const { editor } = behaviorEditor(insertTextPlugin());
    editor.update(
      () => {
        const text = $createTextNode('before old after');
        $getRoot().append($createParagraphNode().append(text));
        text.select(7, 10);
        editor.dispatchCommand(INSERT_TEXT_COMMAND, 'new');
      },
      { discrete: true }
    );
    editor.read(() =>
      expect($getRoot().getTextContent()).toBe('before new after')
    );
  });
});

describe('asynchronous placeholder replacement', () => {
  it.each([true, false])('inserts a placeholder with inline=%s', (inline) => {
    const { editor } = behaviorEditor(awaitPlugin());
    editor.update(
      () => {
        $getRoot().selectEnd();
        editor.dispatchCommand(INSERT_AWAIT_NODE_COMMAND, {
          awaitId: 'fixture-await',
          text: 'Loading',
          inline,
        });
      },
      { discrete: true }
    );
    const serialized = JSON.stringify(editor.getEditorState().toJSON());
    expect(serialized).toContain('fixture-await');
    expect(serialized).toContain('Loading');
  });

  it.each(['one', 'multiple', 'empty', 'missing'] as const)(
    'replaces the matching placeholder with %s nodes',
    (replacement) => {
      const { editor } = behaviorEditor(awaitPlugin());
      editor.update(
        () => {
          $getRoot().append($createParagraphNode());
          $getRoot().selectEnd();
          editor.dispatchCommand(INSERT_AWAIT_NODE_COMMAND, {
            awaitId: 'fixture-await',
            text: 'Loading',
          });
        },
        { discrete: true }
      );
      editor.update(
        () => {
          editor.dispatchCommand(REPLACE_AWAIT_NODE_COMMAND, {
            awaitId:
              replacement === 'missing' ? 'other-await' : 'fixture-await',
            $createReplacement: () => {
              if (replacement === 'empty') return [];
              if (replacement === 'multiple')
                return [$createTextNode('one '), $createTextNode('two')];
              return $createTextNode('one');
            },
          });
        },
        { discrete: true }
      );
      editor.read(() => {
        const expected = {
          one: 'one',
          multiple: 'one two',
          empty: '',
          missing: '',
        };
        expect($getRoot().getTextContent()).toBe(expected[replacement]);
      });
      expect(
        JSON.stringify(editor.getEditorState().toJSON()).includes(
          'fixture-await'
        )
      ).toBe(replacement === 'missing');
    }
  );

  it('ignores a late replacement after its placeholder was deleted', () => {
    const { editor } = behaviorEditor(awaitPlugin());
    editor.update(
      () => {
        $getRoot().selectEnd();
        editor.dispatchCommand(INSERT_AWAIT_NODE_COMMAND, {
          awaitId: 'removed',
        });
      },
      { discrete: true }
    );
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode('new draft')));
      },
      { discrete: true }
    );
    const before = editor.getEditorState().toJSON();
    editor.update(
      () => {
        editor.dispatchCommand(REPLACE_AWAIT_NODE_COMMAND, {
          awaitId: 'removed',
          $createReplacement: () => $createTextNode('stale'),
        });
      },
      { discrete: true }
    );
    expect(editor.getEditorState().toJSON()).toEqual(before);
  });
});

describe('list deletion at boundaries', () => {
  for (const command of [
    DELETE_CHARACTER_COMMAND,
    DELETE_WORD_COMMAND,
    DELETE_LINE_COMMAND,
  ]) {
    it.each(['bullet', 'number', 'check'] as const)(
      `${command.type}: converts %s at offset zero to a paragraph`,
      (kind) => {
        const { editor } = behaviorEditor(customDeletePlugin());
        editor.update(
          () => {
            const text = $createTextNode('keep this text');
            $getRoot().append(
              $createListNode(kind).append($createListItemNode().append(text))
            );
            text.select(0, 0);
            expect(editor.dispatchCommand(command, true)).toBe(true);
          },
          { discrete: true }
        );
        editor.read(() => {
          expect($getRoot().getFirstChild()?.getType()).toBe('paragraph');
          expect($getRoot().getTextContent()).toBe('keep this text');
        });
      }
    );

    it.each([
      [1, 1],
      [0, 3],
    ])(`${command.type}: yields for range %j`, (anchor, focus) => {
      const { editor } = behaviorEditor(customDeletePlugin());
      editor.update(
        () => {
          const text = $createTextNode('keep this text');
          $getRoot().append(
            $createListNode('bullet').append($createListItemNode().append(text))
          );
          text.select(anchor, focus);
          expect(editor.dispatchCommand(command, true)).toBe(false);
        },
        { discrete: true }
      );
      editor.read(() =>
        expect($isListNode($getRoot().getFirstChild())).toBe(true)
      );
    });
  }
});
