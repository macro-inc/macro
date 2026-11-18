import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type InferType, validateSchema } from '@loro-mirror/core';
import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import {
  MARKDOWN_LORO_SCHEMA,
  type MarkdownLoroSchemaType,
} from '@macro-inc/lexical-core/markdown-loro-schema';
import { $updateAllNodeIds } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { LoroDoc, LoroList, LoroMap, LoroMovableList } from 'loro-crdt';
import { expect, test } from 'vitest';
import { toSnapshot } from '../ai-toolkit';
import { setup } from '../ai-toolkit/_test-helpers';
import { Doc } from './doc';

// A table as the ai-editing worker stores it: the headless worker Doc inserts
// it (insertNode {block:'table'}, built by tables.$table with no column widths
// and no resizer plugin), then the worker's own propagate steps (commit, stamp
// ids, editorState.toJSON(), LoroManager.syncToLoro through the Mirror) write
// it to Loro. The snapshot is the Source-written input for native table
// loading; the decode records, per table node, whether each optional table key
// is absent, null or a value in the stored Loro map. Regenerate the snapshot
// with UPDATE_NATIVE_CORPUS=1 (node ids and peers are random per run; the
// decode is what must stay the same).

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const SNAPSHOT = resolve(FIXTURES, 'worker-table.loro');
const DECODE = resolve(FIXTURES, 'worker-table.decode.json');
const TABLE_KEYS = [
  'colWidths',
  'frozenColumnCount',
  'frozenRowCount',
  'rowStriping',
] as const;

type KeyShape = 'absent' | 'null' | { value: unknown };

/** The worker hands editorState.toJSON() to the Mirror; check it is the
 *  Mirror's state shape instead of asserting it. */
function isMarkdownLoroState(
  value: unknown
): value is InferType<MarkdownLoroSchemaType> {
  return validateSchema(MARKDOWN_LORO_SCHEMA, value).valid;
}

/** Each table node's optional keys, read from the stored Loro maps. */
function decodeTables(doc: LoroDoc): Record<string, KeyShape>[] {
  const tables: Record<string, KeyShape>[] = [];
  const visit = (map: LoroMap) => {
    if (map.get('type') === 'table') {
      const keys = new Set(map.keys());
      tables.push(
        Object.fromEntries(
          TABLE_KEYS.map((key): [string, KeyShape] => {
            if (!keys.has(key)) return [key, 'absent'];
            const value = map.get(key);
            if (value === null) return [key, 'null'];
            const plain =
              value instanceof LoroList ||
              value instanceof LoroMovableList ||
              value instanceof LoroMap
                ? value.toJSON()
                : value;
            return [key, { value: plain }];
          })
        )
      );
    }
    const children = map.get('children');
    if (children instanceof LoroMovableList || children instanceof LoroList)
      for (const child of children.toArray())
        if (child instanceof LoroMap) visit(child);
  };
  visit(doc.getMap('root'));
  return tables;
}

test('the worker stores an inserted and then edited table through the Mirror as decoded', async () => {
  const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, {
    documentId: 'worker-table-fixture',
  });
  const init = await manager.initializeFromSnapshot(
    new LoroDoc().export({ mode: 'snapshot' })
  );
  expect(init.isOk()).toBe(true);
  const { session } = setup('Alpha');
  // The worker's propagate (editing-workspace.ts): commit, stamp ids, then
  // sync editorState.toJSON() through the Mirror.
  const propagate = async () => {
    manager.doc.commit();
    session.editor.update(() => $updateAllNodeIds(session.ids), {
      discrete: true,
    });
    const state = toSnapshot(session);
    if (!isMarkdownLoroState(state))
      throw new Error('editor state is not the Mirror state shape');
    const synced = await manager.syncToLoro(state);
    expect(synced.isOk()).toBe(true);
  };
  await propagate();
  new Doc(session).apply({
    kind: 'insertNode',
    ref: 'ref-table',
    spec: {
      block: 'table',
      rows: [
        ['h1', 'h2'],
        ['c1', 'c2'],
      ],
    },
    at: { appendToRoot: true },
  });
  await propagate();
  manager.doc.commit();
  const bytes = manager.doc.export({ mode: 'snapshot' });
  const stored = new LoroDoc();
  stored.import(bytes);
  const inserted = decodeTables(stored);
  expect(inserted).toHaveLength(1);
  // A later worker edit of the same table goes through the Mirror's per-key
  // diff of the existing table map, not the new-container write.
  new Doc(session).apply({
    kind: 'setCell',
    table: 'ref-table',
    row: 1,
    col: 0,
    text: 'c1 edited',
  });
  await propagate();
  manager.doc.commit();
  const edited = new LoroDoc();
  edited.import(manager.doc.export({ mode: 'snapshot' }));
  // The edit reached Loro, so the table map went through the diff.
  expect(JSON.stringify(edited.toJSON())).toContain('c1 edited');
  const decode = { inserted, afterCellEdit: decodeTables(edited) };
  if (process.env.UPDATE_NATIVE_CORPUS === '1') {
    writeFileSync(SNAPSHOT, bytes);
    writeFileSync(DECODE, `${JSON.stringify(decode, null, 2)}\n`);
  }
  // The recorded snapshot decodes the same, and so does a fresh run.
  const recorded = new LoroDoc();
  recorded.import(readFileSync(SNAPSHOT));
  expect(decodeTables(recorded)).toEqual(inserted);
  expect(JSON.parse(readFileSync(DECODE, 'utf8'))).toEqual(decode);
});
