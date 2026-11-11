import {
  $createEquationNode,
  $createUserMentionNode,
  $isEquationNode,
  $isUserMentionNode,
  type UserMentionNode,
} from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $isElementNode,
} from 'lexical';
import { expect, it } from 'vitest';
import {
  katexPlugin,
  UPDATE_EQUATION_COMMAND,
} from '../plugins/katex/katexPlugin';
import {
  mentionsPlugin,
  UPDATE_USER_DISPLAY_NAME_COMMAND,
} from '../plugins/mentions/mentionsPlugin';
import { behaviorEditor } from './editor';

it('actual equation update changes only its expression and rejects empty or wrong targets', () => {
  const { editor } = behaviorEditor(katexPlugin({}));
  editor.update(
    () => {
      const equation = $createEquationNode('x', false);
      const text = $createTextNode('keep');
      $getRoot().append($createParagraphNode().append(equation, text));
      const payload = {
        nodeKey: equation.getKey(),
        equation: 'y^2',
        inline: true,
      };
      expect(editor.dispatchCommand(UPDATE_EQUATION_COMMAND, payload)).toBe(
        true
      );
      const updated = $getNodeByKey(equation.getKey());
      if (!$isEquationNode(updated)) throw new Error('Missing equation');
      expect(updated.getEquation()).toBe('y^2');
      expect(updated.getInline()).toBe(false);
      expect(
        editor.dispatchCommand(UPDATE_EQUATION_COMMAND, {
          nodeKey: equation.getKey(),
          equation: '',
        })
      ).toBe(false);
      expect(
        editor.dispatchCommand(UPDATE_EQUATION_COMMAND, {
          nodeKey: text.getKey(),
          equation: 'wrong',
        })
      ).toBe(false);
      expect(updated.getEquation()).toBe('y^2');
    },
    { discrete: true }
  );
});

it('actual display names retain ID case, truthy whitespace, detached exclusion and source tags', () => {
  const { editor } = behaviorEditor(mentionsPlugin({}));
  let keys: string[] = [];
  let detached: UserMentionNode | undefined;
  editor.update(
    () => {
      const first = $createUserMentionNode({
        userId: 'literal|Identity',
        email: '',
        displayName: 'old',
      });
      const second = $createUserMentionNode({
        userId: 'literal|Identity',
        email: '',
        displayName: 'old',
      });
      const different = $createUserMentionNode({
        userId: 'literal|identity',
        email: '',
        displayName: 'keep',
      });
      detached = $createUserMentionNode({
        userId: 'literal|Identity',
        email: '',
        displayName: 'detached',
      });
      keys = [first.getKey(), second.getKey(), different.getKey()];
      $getRoot().append(
        $createParagraphNode().append(first, second, different)
      );
    },
    { discrete: true }
  );
  const tags: string[][] = [];
  const release = editor.registerUpdateListener((update) => {
    tags.push([...update.tags]);
  });
  try {
    editor.update(
      () => {
        expect(
          editor.dispatchCommand(UPDATE_USER_DISPLAY_NAME_COMMAND, {
            'literal|Identity': ' ',
            'literal|identity': '',
          })
        ).toBe(true);
      },
      { discrete: true }
    );
    editor.getEditorState().read(() => {
      expect(
        keys.map((key) => {
          const node = $getNodeByKey(key);
          if (!$isUserMentionNode(node)) throw new Error('Missing mention');
          return node.getDisplayName();
        })
      ).toEqual([' ', ' ', 'keep']);
    });
    expect(detached?.getDisplayName()).toBe('detached');
    expect(tags.flat()).toEqual(
      expect.arrayContaining([
        'historic',
        'skip-dom-selection',
        'skip-scroll-into-view',
      ])
    );
  } finally {
    release();
  }
});

it('actual empty display-name updates are consumed without changing content', () => {
  const { editor } = behaviorEditor(mentionsPlugin({}));
  editor.update(
    () =>
      $getRoot().append($createParagraphNode().append($createTextNode('keep'))),
    { discrete: true }
  );
  const before = editor.getEditorState().toJSON();
  editor.update(
    () =>
      expect(editor.dispatchCommand(UPDATE_USER_DISPLAY_NAME_COMMAND, {})).toBe(
        true
      ),
    { discrete: true }
  );
  expect(editor.getEditorState().toJSON()).toEqual(before);
});

it('actual legacy missing and null user IDs keep source property lookup semantics', () => {
  const { editor } = behaviorEditor(mentionsPlugin({}));
  const state = editor.parseEditorState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [
              {
                type: 'user-mention',
                version: 1,
                email: '',
                displayName: 'Missing',
              },
              {
                type: 'user-mention',
                version: 1,
                userId: null,
                email: '',
                displayName: 'Null',
              },
            ],
          },
        ],
      },
    })
  );
  editor.setEditorState(state);
  editor.update(
    () => {
      expect(
        editor.dispatchCommand(UPDATE_USER_DISPLAY_NAME_COMMAND, {
          undefined: 'Missing Fresh',
          null: 'Null Fresh',
        })
      ).toBe(true);
    },
    { discrete: true }
  );
  editor.getEditorState().read(() => {
    const p = $getRoot().getFirstChildOrThrow();
    if (!$isElementNode(p)) throw new Error('Missing paragraph');
    expect(
      p.getChildren().map((node) => {
        if (!$isUserMentionNode(node)) throw new Error('Missing mention');
        return [node.getUserId(), node.getDisplayName()];
      })
    ).toEqual([
      [undefined, 'Missing Fresh'],
      [null, 'Null Fresh'],
    ]);
  });
});
