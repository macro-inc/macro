import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type SerializedEditorState,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  $getId,
  $isListItemNode,
  $isTaskListNode,
  $updateAllNodeIds,
  ALL_TRANSFORMERS,
  createDocumentEditor,
} from '../sdk';

describe('sdk entry', () => {
  it('edits a document headless with ids, like an SDK program', () => {
    const editor = createDocumentEditor();
    editor.update(
      () => {
        $convertFromMarkdownString(
          '# Plan\n\n- [ ] draft\n- [ ] ship\n\n| a | b |\n| - | - |\n| 1 | 2 |',
          ALL_TRANSFORMERS
        );
        $updateAllNodeIds({
          idToNodeKeyMap: new Map(),
          nodeKeyToIdMap: new Map(),
        });
      },
      { discrete: true }
    );
    const ids = editor.read(() =>
      $getRoot()
        .getChildren()
        .map((block) => $getId(block))
    );
    expect(ids.every((id) => typeof id === 'string')).toBe(true);

    const reloaded = createDocumentEditor();
    const state: SerializedEditorState = editor.getEditorState().toJSON();
    reloaded.setEditorState(reloaded.parseEditorState(state));
    reloaded.update(
      () => {
        for (const block of $getRoot().getChildren()) {
          if (!$isTaskListNode(block)) continue;
          for (const item of block.getChildren()) {
            if ($isListItemNode(item)) item.setChecked(true);
          }
        }
        $getRoot().append(
          $createParagraphNode().append($createTextNode('added'))
        );
      },
      { discrete: true }
    );

    const markdown = reloaded.read(() =>
      $convertToMarkdownString(ALL_TRANSFORMERS)
    );
    expect(markdown).toBe(
      '# Plan\n\n- [x] draft\n- [x] ship\n\n<m-table><m-table-row><m-table-cell>a</m-table-cell><m-table-cell>b</m-table-cell></m-table-row><m-table-row><m-table-cell>1</m-table-cell><m-table-cell>2</m-table-cell></m-table-row></m-table>\n\nadded'
    );
    expect(
      reloaded.read(() =>
        $getRoot()
          .getChildren()
          .slice(0, ids.length)
          .map((block) => $getId(block))
      )
    ).toEqual(ids);
  });
});
