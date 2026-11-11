import {
  $isTableCellNode,
  $isTableRowNode,
  registerTablePlugin,
  TableNode,
} from '@lexical/table';
import {
  $createParagraphNode,
  $getRoot,
  $nodesOfType,
  COMMAND_PRIORITY_CRITICAL,
  type LexicalCommand,
} from 'lexical';
import { expect, test } from 'vitest';
import { createLexicalActionMenuHost } from '../editing/overlay-hosts/lexical-actions';
import { ACTIONS } from '../plugins/actions/actions';
import { actionsPlugin } from '../plugins/actions/actionsPlugin';
import { TRY_INSERT_GIF_COMMAND } from '../plugins/gif';
import { horizontalRulePlugin } from '../plugins/horizontal-rules/horizontalRulePlugin';
import { TRY_INSERT_EQUATION_COMMAND } from '../plugins/katex/katexPlugin';
import { TRY_INSERT_LINK_COMMAND } from '../plugins/links/linksPlugin';
import { TRY_INSERT_MEDIA_UPLOAD_COMMAND } from '../plugins/media/mediaPlugin';
import { tablePickerPlugin } from '../plugins/tables/tablePickerPlugin';
import { createMenuOperations } from '../shared/inlineMenu';
import { behaviorEditor } from './editor';

const REQUESTS: readonly {
  id: string;
  command: LexicalCommand<unknown>;
  payload: unknown;
}[] = [
  { id: 'image', command: TRY_INSERT_MEDIA_UPLOAD_COMMAND, payload: 'all' },
  { id: 'video', command: TRY_INSERT_MEDIA_UPLOAD_COMMAND, payload: 'all' },
  { id: 'gif', command: TRY_INSERT_GIF_COMMAND, payload: undefined },
  { id: 'link', command: TRY_INSERT_LINK_COMMAND, payload: undefined },
  { id: 'latex', command: TRY_INSERT_EQUATION_COMMAND, payload: undefined },
];

test.each(REQUESTS)(
  'slash $id requests host I/O after removing the actual search',
  async ({ id, command, payload }) => {
    const menu = createMenuOperations();
    const received: unknown[] = [];
    const { editor, root } = behaviorEditor(actionsPlugin({ menu }), (editor) =>
      editor.registerCommand(
        command,
        (value) => {
          expect($getRoot().getTextContent()).toBe('');
          received.push(value);
          return true;
        },
        COMMAND_PRIORITY_CRITICAL
      )
    );
    editor.update(() => $getRoot().append($createParagraphNode()).selectEnd(), {
      discrete: true,
    });
    root.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    editor.read(() => expect($getRoot().getTextContent()).toBe('/'));
    expect(menu.isOpen()).toBe(true);
    const action = ACTIONS.find((action) => action.id === id);
    if (!action) throw new Error('Missing actual source catalog action');
    createLexicalActionMenuHost(() => editor).select(action, 'keyboard');
    expect(received).toEqual([]);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    editor.read(() => expect($getRoot().getTextContent()).toBe(''));
    expect(received).toEqual([payload]);
    expect(menu.isOpen()).toBe(false);
  }
);

test.each([true, false])(
  'slash table preserves picker handled=%s and its direct-insert fallback',
  async (handled) => {
    let requests = 0;
    const { editor } = behaviorEditor(
      registerTablePlugin,
      ...(handled
        ? [
            tablePickerPlugin({
              onCreateTable: () => {
                requests++;
              },
            }),
          ]
        : [])
    );
    editor.update(() => $getRoot().append($createParagraphNode()).selectEnd(), {
      discrete: true,
    });
    const action = ACTIONS.find((action) => action.id === 'table');
    if (!action) throw new Error('Missing source table action');
    action.action(editor);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    editor.read(() => {
      const tables = $nodesOfType(TableNode);
      expect(tables).toHaveLength(handled ? 0 : 1);
      if (!handled) {
        expect(tables[0].getChildrenSize()).toBe(3);
        for (const row of tables[0].getChildren()) {
          if (!$isTableRowNode(row))
            throw new Error('Missing actual table row');
          expect(row.getChildrenSize()).toBe(3);
          for (const cell of row.getChildren()) {
            if (!$isTableCellNode(cell))
              throw new Error('Missing actual table cell');
            expect(cell.getHeaderStyles()).toBe(0);
          }
        }
      }
    });
    expect(requests).toBe(Number(handled));
  }
);

test('slash divider synchronously inserts the actual rule', () => {
  const { editor } = behaviorEditor(horizontalRulePlugin());
  editor.update(() => $getRoot().append($createParagraphNode()).selectEnd(), {
    discrete: true,
  });
  const action = ACTIONS.find((action) => action.id === 'hr');
  if (!action) throw new Error('Missing source divider action');
  action.action(editor);
  editor.read(() => {
    expect(
      $getRoot()
        .getChildren()
        .map((node) => node.getType())
    ).toContain('horizontalrule');
  });
});
