import { NodeReplacements, SupportedNodeTypes } from '@macro-inc/lexical-core';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { $getRoot, createEditor } from 'lexical';
import { beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { queryApplication } from '../group-b/command';
import {
  DO_SEARCH_COMMAND,
  findAndReplacePlugin,
  type NodekeyOffset,
} from './findAndReplacePlugin';

// Real Source plugin vs actual sealed native session. This is not panel,
// highlight geometry, transport, access or Source Loro-history evidence.
const REPLY = z.object({
  pieces: z.array(
    z.object({
      key: z.number().int().nonnegative(),
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
      isReplace: z.boolean(),
      pairKey: z.number().int().positive(),
    })
  ),
});
const text = (value: string, format = 0) => ({
  type: 'text',
  version: 1,
  text: value,
  detail: 0,
  format,
  mode: 'normal',
  style: '',
});
const paragraph = (...children: ReturnType<typeof text>[]) => ({
  type: 'paragraph',
  version: 1,
  children,
  direction: null,
  format: '',
  indent: 0,
  textFormat: 0,
  textStyle: '',
});
const cases = [
  {
    name: 'case-insensitive',
    children: [paragraph(text('One ONE one.'))],
    query: 'one',
    expected: [
      [0, 3, true, 1],
      [4, 7, true, 2],
      [8, 11, true, 3],
    ],
  },
  {
    name: 'escaped literal',
    children: [paragraph(text('a+b ab a+b'))],
    query: 'a+b',
    expected: [
      [0, 3, true, 1],
      [7, 10, true, 2],
    ],
  },
  {
    name: 'formatted leaves',
    children: [paragraph(text('hel', 1), text('lo tail'))],
    query: 'hello',
    expected: [
      [0, 3, true, 1],
      [0, 2, false, 1],
    ],
  },
  {
    name: 'separate blocks',
    children: [paragraph(text('alpha')), paragraph(text('beta'))],
    query: 'alphabeta',
    expected: [],
  },
  {
    name: 'UTF-16 offsets',
    children: [paragraph(text('😀 École éCOLE'))],
    query: 'école',
    expected: [
      [3, 8, true, 1],
      [9, 14, true, 2],
    ],
  },
];
const state = (children: ReturnType<typeof paragraph>[]) =>
  JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      children,
      direction: null,
      format: '',
      indent: 0,
    },
  });

beforeAll(initializeNativeSurfaceTests);

it.each(cases)(
  'Source current plugin: $name',
  ({ children, query, expected }) => {
    const releases: (() => void)[] = [];
    let failed = false;
    let primary: unknown;
    const cleanupErrors: unknown[] = [];
    try {
      const root = document.createElement('div');
      releases.push(() => root.remove());
      document.body.append(root);
      const editor = createEditor({
        namespace: 'document-find-source-control',
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
      editor.setEditorState(editor.parseEditorState(state(children)));
      const before = JSON.stringify(editor.getEditorState().toJSON());
      editor.update(
        () => {
          expect(editor.dispatchCommand(DO_SEARCH_COMMAND, query)).toBe(true);
        },
        { discrete: true }
      );
      expect(
        offsets.map((piece) => [
          piece.offset.start,
          piece.offset.end,
          piece.offset.isReplace,
          piece.pairKey,
        ])
      ).toEqual(expected);
      expect(JSON.stringify(editor.getEditorState().toJSON())).toBe(before);
      editor.read(() =>
        expect($getRoot().getChildrenSize()).toBe(children.length)
      );
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
        'Find Source control cleanup failed'
      );
    }
    if (failed) throw primary;
  }
);

it.each(cases)(
  'Native current producer must match Source: $name',
  ({ children, query, expected }) => {
    const fixture = nativeSurface();
    try {
      fixture.port.setState(state(children));
      expect(fixture.root.children.length).toBe(children.length);
      expect(fixture.view.mirror.keyGeneration).not.toBeNull();
      const before = fixture.session.serializedState();
      let result: z.infer<typeof REPLY>;
      try {
        // Unsupported queries must fail loudly. Never turn null/error into [].
        result = REPLY.parse(
          queryApplication(fixture.view, 'group-b.document-find', {
            search: query,
          })
        );
      } finally {
        expect(fixture.session.serializedState()).toBe(before);
      }
      for (const piece of result.pieces)
        expect(fixture.view.node(piece.key)).toBeDefined();
      expect(
        result.pieces.map((piece) => [
          piece.start,
          piece.end,
          piece.isReplace,
          piece.pairKey,
        ])
      ).toEqual(expected);
    } finally {
      fixture.close();
    }
  }
);
