import { $createCodeNode } from '@lexical/code';
import { $createListItemNode, $createListNode } from '@lexical/list';
import { $isEquationNode } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_TAB_COMMAND,
} from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import {
  horizontalRulePlugin,
  INSERT_HORIZONTAL_RULE_COMMAND,
} from '../plugins/horizontal-rules/horizontalRulePlugin';
import {
  INSERT_EQUATION_COMMAND,
  katexPlugin,
  TRY_INSERT_EQUATION_COMMAND,
  TRY_UPDATE_EQUATION_COMMAND,
  UPDATE_EQUATION_COMMAND,
} from '../plugins/katex/katexPlugin';
import { keyboardFocusPlugin } from '../plugins/keyboard-focus/keyboardFocusPlugin';
import {
  TRY_INSERT_TABLE_PICKER_COMMAND,
  tablePickerPlugin,
} from '../plugins/tables/tablePickerPlugin';
import { behaviorEditor } from './editor';

describe('equation commands', () => {
  it.each([true, false])(
    'inserts and edits an equation with inline=%s',
    (inline) => {
      const { editor } = behaviorEditor(katexPlugin({}));
      let key = '';
      editor.update(
        () => {
          $getRoot().append($createParagraphNode()).selectEnd();
          expect(
            editor.dispatchCommand(INSERT_EQUATION_COMMAND, {
              equation: 'x^2',
              inline,
            })
          ).toBe(true);
        },
        { discrete: true }
      );
      editor.read(() => {
        const equation = $getRoot().getFirstDescendant();
        expect($isEquationNode(equation)).toBe(true);
        if (!$isEquationNode(equation)) throw new Error('Expected equation');
        key = equation.getKey();
        expect(equation.getEquation()).toBe('x^2');
        expect(equation.getInline()).toBe(inline);
      });
      editor.update(
        () => {
          expect(
            editor.dispatchCommand(UPDATE_EQUATION_COMMAND, {
              nodeKey: key,
              equation: 'y^3',
            })
          ).toBe(true);
        },
        { discrete: true }
      );
      expect(JSON.stringify(editor.getEditorState().toJSON())).toContain('y^3');
    }
  );

  it.each(['missing', 'wrong-node', 'empty-equation', 'empty-key'] as const)(
    'rejects %s update targets without changing content',
    (kind) => {
      const { editor } = behaviorEditor(katexPlugin({}));
      let textKey = '';
      editor.update(
        () => {
          const text = $createTextNode('preserve');
          textKey = text.getKey();
          $getRoot().append($createParagraphNode().append(text));
        },
        { discrete: true }
      );
      const before = editor.getEditorState().toJSON();
      editor.update(
        () => {
          expect(
            editor.dispatchCommand(UPDATE_EQUATION_COMMAND, {
              nodeKey:
                kind === 'empty-key'
                  ? ''
                  : kind === 'missing'
                    ? 'absent-node'
                    : textKey,
              equation: kind === 'empty-equation' ? '' : 'replacement',
            })
          ).toBe(false);
        },
        { discrete: true }
      );
      expect(editor.getEditorState().toJSON()).toEqual(before);
    }
  );

  it('requests the existing equation editor through the host callback', () => {
    const click = vi.fn();
    const { editor } = behaviorEditor(katexPlugin({ onClickEquation: click }));
    editor.dispatchCommand(TRY_UPDATE_EQUATION_COMMAND, 'equation-key');
    expect(click).toHaveBeenCalledExactlyOnceWith('equation-key');
  });
});

describe('selection-gated insertion menus', () => {
  it.each([true, false])(
    'table picker requires a selection: %s',
    (hasSelection) => {
      const create = vi.fn();
      const { editor } = behaviorEditor(
        tablePickerPlugin({ onCreateTable: create })
      );
      editor.update(
        () => {
          if (hasSelection)
            $getRoot().append($createParagraphNode()).selectEnd();
          expect(
            editor.dispatchCommand(TRY_INSERT_TABLE_PICKER_COMMAND, undefined)
          ).toBe(hasSelection);
        },
        { discrete: true }
      );
      expect(create).toHaveBeenCalledTimes(Number(hasSelection));
    }
  );

  it.each([true, false])(
    'equation picker requires a selection: %s',
    (hasSelection) => {
      const create = vi.fn();
      const { editor } = behaviorEditor(
        katexPlugin({ onCreateEquation: create })
      );
      editor.update(
        () => {
          if (hasSelection)
            $getRoot().append($createParagraphNode()).selectEnd();
          expect(
            editor.dispatchCommand(TRY_INSERT_EQUATION_COMMAND, undefined)
          ).toBe(hasSelection);
        },
        { discrete: true }
      );
      expect(create).toHaveBeenCalledTimes(Number(hasSelection));
    }
  );
});

describe('horizontal rule insertion', () => {
  it('keeps a caret paragraph when inserting into the only empty block', () => {
    const { editor } = behaviorEditor(horizontalRulePlugin());
    editor.update(
      () => {
        $getRoot().append($createParagraphNode()).selectEnd();
        expect(
          editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)
        ).toBe(true);
      },
      { discrete: true }
    );
    editor.read(() =>
      expect(
        $getRoot()
          .getChildren()
          .map((node) => node.getType())
      ).toEqual(['horizontalrule', 'paragraph'])
    );
  });

  it.each(['bullet', 'number', 'check'] as const)(
    'splits a %s list rather than nesting the rule inside it',
    (kind) => {
      const { editor } = behaviorEditor(horizontalRulePlugin());
      editor.update(
        () => {
          const text = $createTextNode('before');
          $getRoot().append(
            $createListNode(kind).append(
              $createListItemNode().append(text),
              $createListItemNode().append($createTextNode('after'))
            )
          );
          text.select(6, 6);
          editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined);
        },
        { discrete: true }
      );
      editor.read(() => {
        expect(
          $getRoot()
            .getChildren()
            .map((node) => node.getType())
        ).toEqual(['task-list', 'horizontalrule', 'task-list']);
        expect(
          $getRoot()
            .getChildren()
            .map((node) => node.getTextContent())
        ).toEqual(['before', '\n', 'after']);
      });
    }
  );
});

describe('host focus boundary navigation', () => {
  for (const { command, side, offset, shiftKey } of [
    {
      command: KEY_ARROW_LEFT_COMMAND,
      side: 'start',
      offset: 0,
      shiftKey: false,
    },
    {
      command: KEY_ARROW_UP_COMMAND,
      side: 'start',
      offset: 0,
      shiftKey: false,
    },
    {
      command: KEY_ARROW_RIGHT_COMMAND,
      side: 'end',
      offset: 4,
      shiftKey: false,
    },
    {
      command: KEY_ARROW_DOWN_COMMAND,
      side: 'end',
      offset: 4,
      shiftKey: false,
    },
    { command: KEY_TAB_COMMAND, side: 'start', offset: 0, shiftKey: true },
    { command: KEY_TAB_COMMAND, side: 'end', offset: 4, shiftKey: false },
  ]) {
    it(`${command.type} leaves the ${side} boundary with shift=${shiftKey}`, () => {
      const leave = vi.fn();
      const { editor } = behaviorEditor(
        keyboardFocusPlugin({
          ignoreKeys: () => false,
          onFocusLeaveStart: () => leave('start'),
          onFocusLeaveEnd: () => leave('end'),
        })
      );
      editor.update(
        () => {
          const text = $createTextNode('text');
          $getRoot().append($createParagraphNode().append(text));
          text.select(offset, offset);
          expect(
            editor.dispatchCommand(
              command,
              new KeyboardEvent('keydown', { shiftKey })
            )
          ).toBe(true);
        },
        { discrete: true }
      );
      expect(leave).toHaveBeenCalledExactlyOnceWith(side);
    });

    it(`${command.type} yields inside code with shift=${shiftKey}`, () => {
      const leave = vi.fn();
      const { editor } = behaviorEditor(
        keyboardFocusPlugin({
          ignoreKeys: () => false,
          onFocusLeaveStart: leave,
          onFocusLeaveEnd: leave,
        })
      );
      editor.update(
        () => {
          const text = $createTextNode('text');
          $getRoot().append($createCodeNode().append(text));
          text.select(offset, offset);
          expect(
            editor.dispatchCommand(
              command,
              new KeyboardEvent('keydown', { shiftKey })
            )
          ).toBe(false);
        },
        { discrete: true }
      );
      expect(leave).not.toHaveBeenCalled();
    });

    it(`${command.type} is captured while a typeahead owns the keys with shift=${shiftKey}`, () => {
      const leave = vi.fn();
      const { editor } = behaviorEditor(
        keyboardFocusPlugin({
          ignoreKeys: () => true,
          onFocusLeaveStart: leave,
          onFocusLeaveEnd: leave,
        })
      );
      editor.update(
        () => {
          $getRoot().append($createParagraphNode()).selectEnd();
          expect(
            editor.dispatchCommand(
              command,
              new KeyboardEvent('keydown', { shiftKey })
            )
          ).toBe(true);
          expect($isRangeSelection($getSelection())).toBe(true);
        },
        { discrete: true }
      );
      expect(leave).not.toHaveBeenCalled();
    });
  }
});
