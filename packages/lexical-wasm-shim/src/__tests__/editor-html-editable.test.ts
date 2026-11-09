import { createEditor as createOriginal } from 'lexical';
import { expect, test } from 'vitest';
import { getDOMNodeConversionFunction } from '../configuration/html-conversions';
import {
  $getRoot,
  createEditor,
  type EditableListener,
  getActiveEditor,
} from '../editor';
import { DEFAULT_EDITOR_DOM_CONFIG } from '../editor-dom-config';
import { ParagraphNode, TextNode } from '../nodes';
import type { HTMLConfig } from '../nodes/editor-config';

test('editable transitions and cleanup snapshots match Original', () => {
  const original = createOriginal({ editable: false });
  const actual = createEditor({ editable: false });
  const traces: unknown[][] = [];
  try {
    for (const editor of [original, actual]) {
      const trace: unknown[] = [editor.isEditable()];
      const listener: EditableListener = (value) => {
        trace.push(['event', value, editor.isEditable(), editor._updating]);
        return () => trace.push('cleanup');
      };
      const remove = editor.registerEditableListener(listener);
      editor.setEditable(false);
      editor.setEditable(true);
      editor.setEditable(true);
      editor.setEditable(false);
      remove();
      remove();
      trace.push(editor._updating);
      traces.push(trace);
    }
    expect(traces[1]).toEqual(traces[0]);
    expect(traces[1]).toEqual([
      false,
      ['event', true, true, true],
      'cleanup',
      ['event', false, false, true],
      'cleanup',
      false,
    ]);
  } finally {
    actual.dispose();
  }
});

test('configuration samples html and editable before constructing DOM conversions', () => {
  const configuration = (trace: string[]) => ({
    get theme() {
      trace.push('theme');
      return {};
    },
    get nodes() {
      trace.push('nodes');
      return [];
    },
    get html() {
      trace.push('html');
      return {
        get import() {
          trace.push('import');
          return {};
        },
      };
    },
    get editable() {
      trace.push('editable');
      return false;
    },
    get dom() {
      trace.push('dom');
      return {};
    },
  });
  const expected: string[] = [];
  const observed: string[] = [];
  createOriginal(configuration(expected));
  const actual = createEditor(configuration(observed));
  try {
    expect(observed).toEqual(expected);
  } finally {
    actual.dispose();
  }
});

test('configured node iteration precedes html and editable getters', () => {
  const configuration = (trace: string[]) => ({
    nodes: new (class extends Array<never> {
      override [Symbol.iterator]() {
        trace.push('iterate');
        return super[Symbol.iterator]();
      }
    })(),
    get html() {
      trace.push('html');
      return {};
    },
    get editable() {
      trace.push('editable');
      return false;
    },
  });
  const expected: string[] = [];
  const observed: string[] = [];
  createOriginal(configuration(expected));
  const actual = createEditor(configuration(observed));
  try {
    expect(observed).toEqual(expected);
    expect(observed).toEqual(['iterate', 'html', 'editable', 'editable']);
  } finally {
    actual.dispose();
  }
});

test('editable listener removal during dispatch runs returned cleanup immediately', () => {
  const editor = createEditor();
  const trace: string[] = [];
  let remove = () => {};
  try {
    remove = editor.registerEditableListener(() => {
      remove();
      trace.push('listener');
      return () => trace.push('cleanup');
    });
    editor.setEditable(false);
    editor.setEditable(true);
    expect(trace).toEqual(['listener', 'cleanup']);
  } finally {
    editor.dispose();
  }
});

test('editable notification restores phase after opaque errors without granting a dollar scope', () => {
  const editor = createEditor();
  const thrown = {};
  try {
    const remove = editor.registerEditableListener(() => {
      expect(() => getActiveEditor()).toThrow('active editor');
      throw thrown;
    });
    expect(() => editor.setEditable(false)).toThrow(thrown);
    expect(editor._updating).toBe(false);
    expect(editor.isEditable()).toBe(false);
    remove();
    editor.setEditable(true);
  } finally {
    editor.dispose();
  }
});

test('editable listeners enqueue ordinary updates until the next real update, like Original', () => {
  const original = createOriginal();
  const actual = createEditor();
  const traces: string[][] = [];
  try {
    for (const editor of [original, actual]) {
      const trace: string[] = [];
      const remove = editor.registerEditableListener(() => {
        trace.push('listener');
        editor.update(() => trace.push('queued'));
        trace.push('returned');
      });
      editor.setEditable(false);
      trace.push('setter-returned');
      editor.update(() => trace.push('next'), { discrete: true });
      remove();
      traces.push(trace);
    }
    expect(traces[1]).toEqual(traces[0]);
  } finally {
    actual.dispose();
  }
});

test('noneditable configuration still permits programmatic native edits', () => {
  const editor = createEditor({
    editable: false,
    onError(error) {
      throw error;
    },
  });
  try {
    editor.update(
      () =>
        $getRoot().append(
          new ParagraphNode().append(new TextNode('programmatic'))
        ),
      { discrete: true }
    );
    expect(editor.getEditorState().toJSON().root.children.length).toBe(1);
    expect(editor.isEditable()).toBe(false);
  } finally {
    editor.dispose();
  }
});

test('HTML import factories and registered export overrides run their actual JS hooks', () => {
  const document = new DOMParser().parseFromString(
    '<custom>input</custom>',
    'text/html'
  );
  const calls: string[] = [];
  const html: HTMLConfig = {
    import: {
      custom: () => ({
        priority: 4,
        conversion: () => ({ node: new TextNode('converted') }),
      }),
    },
    export: new Map([
      [
        ParagraphNode,
        (editor, node) => {
          expect(editor._nodes.get('paragraph')?.klass).toBe(ParagraphNode);
          expect(node).toBeInstanceOf(ParagraphNode);
          calls.push('export');
          return { element: document.createElement('section') };
        },
      ],
    ]),
  };
  const editor = createEditor({
    html,
    onError(error) {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const element = document.querySelector('custom');
        if (!element) throw new Error('Missing actual DOM element');
        const convert = getDOMNodeConversionFunction(
          element,
          editor._htmlConversions
        );
        if (!convert) throw new Error('Missing actual configured converter');
        const result = convert(element);
        if (!(result?.node instanceof TextNode))
          throw new Error('Expected actual converted node');
        expect(result.node.__text).toBe('converted');
        const paragraph = new ParagraphNode();
        const output = DEFAULT_EDITOR_DOM_CONFIG.$exportDOM(paragraph, editor);
        expect(output.element?.nodeName).toBe('SECTION');
        $getRoot().append(paragraph.append(result.node));
      },
      { discrete: true }
    );
    expect(calls).toEqual(['export']);
  } finally {
    editor.dispose();
  }
});
