import { expect, test, vi } from 'vitest';
import { prepareEditorRegisteredNodes } from '../configuration/registered-nodes';
import { $getRoot, createEditor } from '../editor';
import { ElementNode, ParagraphNode, TextNode } from '../nodes';
import { exportNodeToJSON, exportRootToJSON } from './export';
import { parseSerializedNodeWithRegistry } from './parse';

test('export traverses actual nodes through JS hooks and appends to their exact children arrays', () => {
  const editor = createEditor({
    namespace: 'JS JSON export',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const root = $getRoot();
        const paragraph = new ParagraphNode();
        const first = new TextNode('alpha');
        const second = new TextNode('beta');
        paragraph.append(first, second);
        root.append(paragraph);
        const paragraphJSON = paragraph.exportJSON();
        const preexisting = { type: 'preexisting', version: 1 };
        paragraphJSON.children.push(preexisting);
        const children = paragraphJSON.children;
        const opaque = { retained: true };
        const firstJSON = Object.assign(first.exportJSON(), { opaque });
        const paragraphHook = vi
          .spyOn(paragraph, 'exportJSON')
          .mockReturnValue(paragraphJSON);
        const firstHook = vi
          .spyOn(first, 'exportJSON')
          .mockReturnValue(firstJSON);
        try {
          const exported = exportRootToJSON(root);
          expect(exported.type).toBe('root');
          expect(exported.children[0]).toBe(paragraphJSON);
          expect(paragraphJSON.children).toBe(children);
          expect(children[0]).toBe(preexisting);
          expect(children[1]).toBe(firstJSON);
          expect(children).toMatchObject([
            { type: 'preexisting' },
            { type: 'text', text: 'alpha' },
            { type: 'text', text: 'beta' },
          ]);
          expect(firstJSON.opaque).toBe(opaque);
          expect(paragraphHook).toHaveBeenCalledTimes(1);
          expect(firstHook).toHaveBeenCalledTimes(1);
        } finally {
          paragraphHook.mockRestore();
          firstHook.mockRestore();
        }
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});

test('export validates hook type and children before traversing a live element', () => {
  const editor = createEditor({
    namespace: 'JS JSON validation',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const paragraph = new ParagraphNode().append(new TextNode('child'));
        $getRoot().append(paragraph);
        const json = paragraph.exportJSON();
        const getChildren = vi.spyOn(paragraph, 'getChildren');
        const exportJSON = vi.spyOn(paragraph, 'exportJSON');
        try {
          exportJSON.mockReturnValue({ ...json, type: 'incorrect' });
          expect(() => exportNodeToJSON(paragraph)).toThrow(
            'does not match the serialized type'
          );
          expect(getChildren).not.toHaveBeenCalled();
          Reflect.set(json, 'children', null);
          exportJSON.mockReturnValue(json);
          expect(() => exportNodeToJSON(paragraph)).toThrow(
            'does not have a children array'
          );
          expect(getChildren).not.toHaveBeenCalled();
        } finally {
          exportJSON.mockRestore();
          getChildren.mockRestore();
        }
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});

test('parse uses actual registered import hooks before children getters and appends after child import', () => {
  const registry = prepareEditorRegisteredNodes({
    configOmitted: false,
  }).registeredNodes;
  const editor = createEditor({
    namespace: 'JS JSON import',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const events: string[] = [];
        const paragraph = new ParagraphNode();
        const append = vi.spyOn(paragraph, 'append');
        const importParagraph = vi
          .spyOn(ParagraphNode, 'importJSON')
          .mockImplementation(() => {
            events.push('import:paragraph');
            return paragraph;
          });
        const importText = vi
          .spyOn(TextNode, 'importJSON')
          .mockImplementation((serialized) => {
            events.push('import:text');
            return new TextNode(serialized.text);
          });
        const child = {
          type: 'text',
          version: 1,
          text: 'imported',
          get children() {
            events.push('children:text');
            expect(paragraph.getChildrenSize()).toBe(0);
            return [];
          },
        };
        const input = {
          type: 'paragraph',
          version: 1,
          get children() {
            events.push('children:paragraph');
            return [child];
          },
        };
        try {
          const parsed = parseSerializedNodeWithRegistry(input, registry);
          expect(parsed).toBe(paragraph);
          expect(events).toEqual([
            'import:paragraph',
            'children:paragraph',
            'import:text',
            'children:text',
          ]);
          expect(append).toHaveBeenCalledTimes(1);
          expect(append.mock.invocationCallOrder[0]).toBeGreaterThan(
            importText.mock.invocationCallOrder[0]
          );
          if (!(parsed instanceof ElementNode))
            throw new Error('expected actual element');
          expect(parsed.getChildren()[0].getTextContent()).toBe('imported');
          $getRoot().append(parsed);
        } finally {
          importText.mockRestore();
          importParagraph.mockRestore();
          append.mockRestore();
        }
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});

test('parse rejects unknown and mismatched registered types before importJSON', () => {
  const registry = prepareEditorRegisteredNodes({
    configOmitted: false,
  }).registeredNodes;
  const importJSON = vi.spyOn(TextNode, 'importJSON');
  try {
    expect(() =>
      parseSerializedNodeWithRegistry({ type: 'missing', version: 1 }, registry)
    ).toThrow('type "missing" + not found');
    const text = registry.get('text');
    if (!text) throw new Error('missing real Text registration');
    registry.set('different', text);
    expect(() =>
      parseSerializedNodeWithRegistry(
        { type: 'different', version: 1 },
        registry
      )
    ).toThrow('does not implement .importJSON()');
    expect(importJSON).not.toHaveBeenCalled();
  } finally {
    importJSON.mockRestore();
  }
});
