import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  ParagraphNode,
} from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import {
  $applyDocumentMetadataFromSerialized,
  $getDocumentMetadata,
  documentMetadataPlugin,
} from '../plugins/document-metadata/documentMetadataPlugin';
import {
  createAccessoryStore,
  FORCE_REFRESH_ACCESSORIES_COMMAND,
  nodeAccessoryPlugin,
} from '../plugins/node-accessory/nodeAccessoryPlugin';
import {
  $getPinnedProperties,
  $getStoredPinnedProperties,
  ADD_PINNED_PROPERTY_COMMAND,
  pinnedPropertiesPlugin,
  REMOVE_PINNED_PROPERTY_COMMAND,
} from '../plugins/pinned-properties/pinnedPropertiesPlugin';
import { MARKDOWN_VERSION_COUNTER } from '../version';
import { behaviorEditor } from './editor';

describe('persisted root metadata', () => {
  it('distinguishes untouched pins from a deliberately saved empty list', () => {
    const { editor } = behaviorEditor(pinnedPropertiesPlugin());
    editor.update(() => $getRoot().append($createParagraphNode()), {
      discrete: true,
    });
    editor.read(() => {
      expect($getPinnedProperties()).toEqual([]);
      expect($getStoredPinnedProperties()).toBeUndefined();
    });
    editor.update(
      () => {
        editor.dispatchCommand(ADD_PINNED_PROPERTY_COMMAND, 'fixture-property');
        editor.dispatchCommand(
          REMOVE_PINNED_PROPERTY_COMMAND,
          'fixture-property'
        );
      },
      { discrete: true }
    );
    editor.read(() => expect($getStoredPinnedProperties()).toEqual([]));
    expect(editor.getEditorState().toJSON().root.$).toEqual({
      pinnedPropertyIds: [],
    });
  });

  it('deduplicates additions, preserves pin order and ignores unknown removals', () => {
    const { editor } = behaviorEditor(pinnedPropertiesPlugin());
    editor.update(
      () => {
        $getRoot().append($createParagraphNode());
        for (const property of ['first', 'second', 'first'])
          editor.dispatchCommand(ADD_PINNED_PROPERTY_COMMAND, property);
        editor.dispatchCommand(REMOVE_PINNED_PROPERTY_COMMAND, 'absent');
      },
      { discrete: true }
    );
    editor.read(() =>
      expect($getPinnedProperties()).toEqual(['first', 'second'])
    );
    editor.setEditorState(
      editor.parseEditorState(editor.getEditorState().toJSON())
    );
    editor.read(() =>
      expect($getStoredPinnedProperties()).toEqual(['first', 'second'])
    );
  });

  it('restores document metadata from serialized root state', () => {
    const { editor } = behaviorEditor();
    editor.update(() => $getRoot().append($createParagraphNode()), {
      discrete: true,
    });
    const state = editor.getEditorState().toJSON();
    editor.update(
      () => {
        $applyDocumentMetadataFromSerialized({
          ...state,
          root: {
            ...state.root,
            $: {
              documentMetadata: { version: 7, environmentTags: ['fixture'] },
            },
          },
        });
      },
      { discrete: true }
    );
    editor.read(() =>
      expect($getDocumentMetadata()).toEqual({
        version: 7,
        environmentTags: ['fixture'],
      })
    );
    expect(editor.getEditorState().toJSON().root.$).toEqual({
      documentMetadata: { version: 7, environmentTags: ['fixture'] },
    });
  });

  it('reports a document version newer than this client supports', () => {
    const unsupported = vi.fn();
    const { editor } = behaviorEditor(
      documentMetadataPlugin({ onVersionError: unsupported })
    );
    editor.update(() => $getRoot().append($createParagraphNode()), {
      discrete: true,
    });
    const state = editor.getEditorState().toJSON();
    editor.update(
      () => {
        $applyDocumentMetadataFromSerialized({
          ...state,
          root: {
            ...state.root,
            $: { documentMetadata: { version: MARKDOWN_VERSION_COUNTER + 1 } },
          },
        });
      },
      { discrete: true }
    );
    expect(unsupported).toHaveBeenCalled();
  });
});

describe('node accessory lifecycle', () => {
  it('tracks mounted paragraph DOM, updates and destroyed node keys', () => {
    const [store, setStore] = createAccessoryStore();
    const component = () => null;
    const { editor, root } = behaviorEditor(
      nodeAccessoryPlugin({ klass: ParagraphNode, component, store, setStore })
    );
    let key = '';
    editor.update(
      () => {
        const paragraph = $createParagraphNode().append(
          $createTextNode('first')
        );
        key = paragraph.getKey();
        $getRoot().append(paragraph);
      },
      { discrete: true }
    );
    expect(store[key].component).toBe(component);
    expect(store[key].mountRef).toBe(root.firstElementChild);
    expect(
      store[key].mountRef.classList.contains('__decorator-mount-ref')
    ).toBe(true);
    editor.update(
      () => {
        const paragraph = $getNodeByKey(key);
        if (!$isElementNode(paragraph)) throw new Error('Expected paragraph');
        paragraph.append($createTextNode(' second'));
      },
      { discrete: true }
    );
    expect(store[key].mountRef.textContent).toBe('first second');
    editor.update(() => $getRoot().clear(), { discrete: true });
    expect(store[key]).toBeUndefined();
  });

  it('force refresh preserves the accessory data and yields command propagation', () => {
    const [store, setStore] = createAccessoryStore();
    const component = () => null;
    const { editor } = behaviorEditor(
      nodeAccessoryPlugin({ klass: ParagraphNode, component, store, setStore })
    );
    let key = '';
    editor.update(
      () => {
        const paragraph = $createParagraphNode().append(
          $createTextNode('text')
        );
        key = paragraph.getKey();
        $getRoot().append(paragraph);
      },
      { discrete: true }
    );
    const mount = store[key].mountRef;
    expect(
      editor.dispatchCommand(FORCE_REFRESH_ACCESSORIES_COMMAND, [
        key,
        'missing-node',
      ])
    ).toBe(false);
    expect(store[key].component).toBe(component);
    expect(store[key].mountRef).toBe(mount);
    expect(store['missing-node']).toBeUndefined();
  });
});
