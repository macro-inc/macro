import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NodeReplacements, SupportedNodeTypes } from '@macro-inc/lexical-core';
import { $getNodeByKey, $getSelection, createEditor } from 'lexical';
import { expect, it } from 'vitest';
import {
  DO_SEARCH_COMMAND,
  findAndReplacePlugin,
  type NodekeyOffset,
} from './findAndReplacePlugin';

const cases: {
  name: string;
  text: number[];
  query: number[];
  ranges: [number, number][];
}[] = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      '../../crates/client/lexical/macro_document_model/src/plugins_group_b/document_find/source-surrogate-oracle.json'
    ),
    'utf8'
  )
);

// This Source-only raw-unit control does NOT widen the native string ABI,
// which rejects lone surrogates. Production query coverage uses valid strings.
it.each(cases)('Source surrogate units: $name', ({ text, query, ranges }) => {
  const releases: (() => void)[] = [];
  const cleanupErrors: unknown[] = [];
  let failed = false;
  let primary: unknown;
  try {
    const root = document.createElement('div');
    releases.push(() => root.remove());
    document.body.append(root);
    const editor = createEditor({
      namespace: 'source-document-find-surrogates',
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
    editor.setEditorState(
      editor.parseEditorState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            direction: null,
            format: '',
            indent: 0,
            children: [
              {
                type: 'paragraph',
                version: 1,
                direction: null,
                format: '',
                indent: 0,
                textFormat: 0,
                textStyle: '',
                children: [
                  {
                    type: 'text',
                    version: 1,
                    text: String.fromCharCode(...text),
                    format: 0,
                    detail: 0,
                    mode: 'normal',
                    style: '',
                  },
                ],
              },
            ],
          },
        })
      )
    );
    const before = JSON.stringify(editor.getEditorState().toJSON());
    const selection = editor
      .getEditorState()
      .read(() => $getSelection()?.clone() ?? null);
    editor.update(
      () => {
        expect(
          editor.dispatchCommand(
            DO_SEARCH_COMMAND,
            String.fromCharCode(...query)
          )
        ).toBe(true);
      },
      { discrete: true }
    );
    expect(
      offsets.map((piece) => [piece.offset.start, piece.offset.end])
    ).toEqual(ranges);
    editor.getEditorState().read(() => {
      for (const [index, piece] of offsets.entries()) {
        expect($getNodeByKey(piece.key)?.getTextContent()).toBe(
          String.fromCharCode(...text)
        );
        expect(piece.offset.isReplace).toBe(true);
        expect(piece.pairKey).toBe(index + 1);
      }
      const current = $getSelection();
      if (selection === null) expect(current).toBeNull();
      else expect(current?.is(selection)).toBe(true);
    });
    expect(JSON.stringify(editor.getEditorState().toJSON())).toBe(before);
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
      'Source surrogate oracle cleanup failed'
    );
  }
  if (failed) throw primary;
});
