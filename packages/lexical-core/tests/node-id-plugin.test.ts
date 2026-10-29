import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import {
  $getId,
  type NodeIdMappings,
  nodeIdPlugin,
} from '../plugins/nodeIdPlugin';

describe('nodeIdPlugin', () => {
  it('unmaps every node destroyed in one update', () => {
    const editor = createEditor({
      nodes: SupportedNodeTypes,
      onError: (error) => {
        throw error;
      },
    });
    editor.setRootElement(document.createElement('div'));
    const mappings: NodeIdMappings = {
      idToNodeKeyMap: new Map(),
      nodeKeyToIdMap: new Map(),
    };
    nodeIdPlugin({ nodes: SupportedNodeTypes, mappings })(editor);

    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode('one')),
          $createParagraphNode().append($createTextNode('two')),
          $createParagraphNode().append($createTextNode('three'))
        );
      },
      { discrete: true }
    );
    const ids = editor.read(() =>
      $getRoot()
        .getChildren()
        .flatMap((paragraph) => [paragraph, ...paragraph.getChildren()])
        .map((node) => $getId(node))
    );
    expect(ids).toHaveLength(6);
    for (const id of ids) expect(mappings.idToNodeKeyMap.has(id!)).toBe(true);

    editor.update(
      () => {
        $getRoot().clear().append($createParagraphNode());
      },
      { discrete: true }
    );

    for (const id of ids) expect(mappings.idToNodeKeyMap.has(id!)).toBe(false);
  });
});
