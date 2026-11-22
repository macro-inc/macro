// @vitest-environment jsdom
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $createAwaitNode, $isAwaitNode } from '@macro-inc/lexical-core';
import {
  $createNodeSelection,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
} from 'lexical';
import { expect, test } from 'vitest';
import { behaviorEditor } from '../../behavior-inventory/editor';
import { awaitPlugin, INSERT_AWAIT_NODE_COMMAND } from './awaitPlugin';

function selectionSnapshot() {
  const selection = $getSelection();
  if ($isRangeSelection(selection))
    return {
      kind: 'range',
      anchor: {
        key: selection.anchor.key,
        type: selection.anchor.type,
        offset: selection.anchor.offset,
      },
      focus: {
        key: selection.focus.key,
        type: selection.focus.type,
        offset: selection.focus.offset,
      },
    };
  if ($isNodeSelection(selection))
    return {
      kind: 'node',
      keys: selection.getNodes().map((node) => node.getKey()),
    };
  return { kind: 'none' };
}

for (const kind of ['empty-node', 'element'] as const) {
  for (const pending of [false, true]) {
    test(`Source ${pending ? 'pending' : 'committed'} ${kind} selection at actual Await handler`, () => {
      const { editor } = behaviorEditor(awaitPlugin());
      let paragraphKey = '';
      editor.update(
        () => {
          const p = $createParagraphNode();
          if (kind === 'empty-node')
            p.append($createAwaitNode({ awaitId: 'old' }));
          else p.append($createTextNode('abcd'));
          paragraphKey = p.getKey();
          $getRoot().append(p);
        },
        { discrete: true }
      );
      const before = JSON.stringify(editor.getEditorState());
      let intended: ReturnType<typeof selectionSnapshot> | undefined;
      let observed: ReturnType<typeof selectionSnapshot> | undefined;
      let failure: unknown;
      let handled: boolean | undefined;
      const stop = editor.registerCommand(
        INSERT_AWAIT_NODE_COMMAND,
        () => {
          observed = selectionSnapshot();
          return false;
        },
        COMMAND_PRIORITY_HIGH
      );
      const setSelection = () => {
        if (kind === 'empty-node') $setSelection($createNodeSelection());
        else {
          const selection = $createRangeSelection();
          selection.anchor.set(paragraphKey, 0, 'element');
          selection.focus.set(paragraphKey, 1, 'element');
          $setSelection(selection);
        }
        intended = selectionSnapshot();
      };
      const dispatch = () => {
        handled = editor.dispatchCommand(INSERT_AWAIT_NODE_COMMAND, {
          awaitId: 'new',
          text: 'Creating fixture',
        });
      };
      try {
        try {
          if (pending)
            editor.update(
              () => {
                setSelection();
                dispatch();
              },
              { discrete: true }
            );
          else {
            editor.update(setSelection, { discrete: true });
            dispatch();
          }
          editor.read(() => {});
        } catch (error) {
          failure = error;
        }
        const after = JSON.stringify(editor.getEditorState());
        const record = {
          kind,
          pending,
          intended,
          observed,
          handled,
          before,
          after,
          failure:
            failure instanceof Error
              ? { name: failure.name, message: failure.message }
              : String(failure),
        };
        const output = process.env.CREATION_SOURCE_PROOF_DIR;
        if (output)
          writeFileSync(
            join(
              output,
              `source-${kind}-${pending ? 'pending' : 'committed'}.json`
            ),
            JSON.stringify(record, null, 2) + '\n',
            { mode: 0o600 }
          );
        console.log(
          'creation-source-selection-boundary',
          JSON.stringify(record)
        );
        if (pending) {
          expect(failure).toBeInstanceOf(Error);
          expect(after).toBe(before);
          expect(observed?.kind).toBe(kind === 'empty-node' ? 'node' : 'range');
          if (kind === 'element')
            expect(observed?.anchor?.type).toBe('element');
        } else {
          expect(failure).toBeUndefined();
          expect(handled).toBe(true);
          if (kind === 'empty-node') expect(observed?.kind).toBe('none');
          else expect(observed?.anchor?.type).toBe('text');
          editor.read(() => {
            const paragraph = $getRoot().getFirstChildOrThrow();
            if (!$isElementNode(paragraph))
              throw new Error('Missing Source paragraph');
            const nodes = paragraph.getChildren();
            expect(nodes).toHaveLength(2);
            const last = nodes.at(-1);
            expect($isAwaitNode(last) && last.getAwaitId()).toBe('new');
          });
        }
      } finally {
        stop();
      }
    });
  }
}
