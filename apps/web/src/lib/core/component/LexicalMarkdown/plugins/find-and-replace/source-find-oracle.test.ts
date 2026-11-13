import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NodeReplacements, SupportedNodeTypes } from '@macro-inc/lexical-core';
import {
  $getNodeByKey,
  $getSelection,
  createEditor,
  type NodeKey,
} from 'lexical';
import { expect, it } from 'vitest';
import {
  DO_SEARCH_COMMAND,
  findAndReplacePlugin,
  type NodekeyOffset,
} from './findAndReplacePlugin';

const cases: {
  name: string;
  input: unknown;
  searches: { query: string; pieces: unknown }[];
}[] = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      '../../crates/client/lexical/macro_document_model/src/plugins_group_b/document_find/source-oracle.json'
    ),
    'utf8'
  )
);

it.each(cases)('Source find tuples: $name', ({ input, searches }) => {
  const releases: (() => void)[] = [];
  let failed = false;
  let primary: unknown;
  const cleanupErrors: unknown[] = [];
  try {
    const root = document.createElement('div');
    releases.push(() => root.remove());
    document.body.append(root);
    const editor = createEditor({
      namespace: 'source-document-find-oracle',
      nodes: [...SupportedNodeTypes, ...NodeReplacements],
      onError(error) {
        throw error;
      },
    });
    releases.push(() => editor.setRootElement(null));
    editor.setRootElement(root);
    let offsets: NodekeyOffset[] = [];
    const stop = findAndReplacePlugin({
      getListOffset: () => offsets,
      setListOffset: (value) => {
        offsets = value;
      },
    })(editor);
    releases.push(stop);
    editor.setEditorState(editor.parseEditorState(JSON.stringify(input)));
    const path = (key: NodeKey): number[] => {
      const result: number[] = [];
      let node = $getNodeByKey(key);
      if (!node) throw new Error('Missing result leaf');
      while (node.getParent()) {
        result.push(node.getIndexWithinParent());
        node = node.getParentOrThrow();
      }
      return result.reverse();
    };
    for (const search of searches) {
      const before = JSON.stringify(editor.getEditorState().toJSON());
      const selection = editor
        .getEditorState()
        .read(() => $getSelection()?.clone() ?? null);
      editor.update(
        () => {
          expect(editor.dispatchCommand(DO_SEARCH_COMMAND, search.query)).toBe(
            true
          );
        },
        { discrete: true }
      );
      editor.getEditorState().read(() => {
        expect(
          offsets.map((piece) => ({
            path: path(piece.key),
            start: piece.offset.start,
            end: piece.offset.end,
            isReplace: piece.offset.isReplace,
            pairKey: piece.pairKey,
          }))
        ).toEqual(search.pieces);
      });
      expect(JSON.stringify(editor.getEditorState().toJSON())).toBe(before);
      editor.getEditorState().read(() => {
        const current = $getSelection();
        if (selection === null) expect(current).toBeNull();
        else expect(current?.is(selection)).toBe(true);
      });
    }
  } catch (error) {
    failed = true;
    primary = error;
  } finally {
    for (const release of releases.reverse()) {
      try {
        release();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      failed ? [primary, ...cleanupErrors] : cleanupErrors,
      'Source find oracle cleanup failed'
    );
  }
  if (failed) throw primary;
});
