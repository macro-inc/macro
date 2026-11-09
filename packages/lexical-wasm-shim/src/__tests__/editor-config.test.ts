import { expect, test } from 'vitest';
import {
  createEditor,
  getEditorDOMRenderConfig,
  isCurrentlyReadOnlyMode,
} from '../editor';
import { TextNode } from '../nodes';
import type { EditorDOMRenderConfig } from '../nodes/editor-config';

test('normalization reads configuration getters once and preserves hook identity', () => {
  let namespaceReads = 0;
  let errorReads = 0;
  let domReads = 0;
  let nodeReads = 0;
  const theme = { paragraph: 'paragraph' };
  const update: EditorDOMRenderConfig['$updateDOM'] = () => false;
  const onError = (error: unknown) => {
    throw error;
  };
  const editor = createEditor({
    get nodes() {
      nodeReads++;
      return nodeReads === 1 ? [] : undefined;
    },
    get namespace() {
      namespaceReads++;
      return 'configured';
    },
    get onError() {
      errorReads++;
      return onError;
    },
    get dom() {
      domReads++;
      return { $updateDOM: update };
    },
    theme,
    disableEvents: true,
  });
  try {
    expect(nodeReads).toBe(1);
    expect(namespaceReads).toBe(1);
    expect(errorReads).toBe(1);
    expect(domReads).toBe(1);
    expect(editor._config.namespace).toBe('configured');
    expect(editor._config.theme).toBe(theme);
    expect(editor._config.disableEvents).toBe(true);
    const dom = getEditorDOMRenderConfig(editor);
    expect(dom).toBe(editor._config.dom);
    expect(dom.$updateDOM).toBe(update);
    expect(typeof dom.$getDOMSlot).toBe('function');
  } finally {
    editor.dispose();
  }
});

test('implicit child editors inherit namespace while explicit configuration starts a new parent scope', () => {
  const parent = createEditor({ namespace: 'parent' });
  let implicit: ReturnType<typeof createEditor> | undefined;
  let explicit: ReturnType<typeof createEditor> | undefined;
  try {
    parent.update(
      () => {
        implicit = createEditor();
        explicit = createEditor({ namespace: 'explicit' });
      },
      { discrete: true }
    );
    expect(implicit?._parentEditor).toBe(parent);
    expect(implicit?._config.namespace).toBe('parent');
    expect(explicit?._parentEditor).toBe(null);
    expect(explicit?._config.namespace).toBe('explicit');
  } finally {
    implicit?.dispose();
    explicit?.dispose();
    parent.dispose();
  }
});

test('historical reads restore readonly mode through throws and nested editor updates', () => {
  const editor = createEditor();
  const nested = createEditor();
  const failure = new Error('read failure');
  try {
    const state = editor.getEditorState();
    editor.update(
      () => {
        expect(isCurrentlyReadOnlyMode()).toBe(false);
        state.read(() => {
          expect(isCurrentlyReadOnlyMode()).toBe(true);
          nested.update(
            () => {
              expect(isCurrentlyReadOnlyMode()).toBe(false);
            },
            { discrete: true }
          );
          expect(isCurrentlyReadOnlyMode()).toBe(true);
        });
        expect(isCurrentlyReadOnlyMode()).toBe(false);
        expect(() =>
          state.read(() => {
            expect(isCurrentlyReadOnlyMode()).toBe(true);
            throw failure;
          })
        ).toThrow(failure);
        expect(isCurrentlyReadOnlyMode()).toBe(false);
      },
      { discrete: true }
    );
    expect(isCurrentlyReadOnlyMode()).toBe(false);
  } finally {
    nested.dispose();
    editor.dispose();
  }
});

test('default editor configuration constructs a readable empty state', () => {
  const editor = createEditor();
  try {
    expect(editor.getEditorState().isEmpty()).toBe(true);
  } finally {
    editor.dispose();
  }
});

test('JS error callbacks stay outside the native serialized configuration', () => {
  const failure = new Error('configuration callback');
  const observed: unknown[] = [];
  const editor = createEditor({ onError: (error) => observed.push(error) });
  try {
    editor.update(() => {
      throw failure;
    });
    expect(observed).toEqual([failure]);
    expect(editor.getEditorState().isEmpty()).toBe(true);
  } finally {
    editor.dispose();
  }
});

test('development construction rejects unsupported JS class registrations', () => {
  class CustomText extends TextNode {
    static getType(): string {
      return 'configured-text';
    }
  }
  expect(() => createEditor({ nodes: [CustomText] })).toThrow(
    'JS node class registration requires the production compatibility host'
  );
});
