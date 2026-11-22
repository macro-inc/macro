/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import { behaviorEditor } from '@core/component/LexicalMarkdown/behavior-inventory/editor';
import { getSaveState } from '@core/component/LexicalMarkdown/utils';
import { expect, onTestFinished, test } from 'vitest';
import { mount } from '../component/format-host/native-test-fixture';
import { currentSavedState } from './current-state';

// One stored document as the app saves it: every node has an id (Source
// writes searchText only for root children with one) and current root
// metadata, so neither engine writes on open; plus a custom-code block, whose
// children getSaveState strips.
const STORED = JSON.stringify({
  root: {
    type: 'root',
    version: 1,
    $: { documentMetadata: { version: 11, environmentTags: null } },
    children: [
      {
        type: 'heading',
        version: 1,
        tag: 'h1',
        $: { id: 'headId01' },
        children: [
          { type: 'text', version: 1, text: 'Title', $: { id: 'titleTxt' } },
        ],
      },
      {
        type: 'paragraph',
        version: 1,
        $: { id: 'paraId01' },
        children: [
          {
            type: 'text',
            version: 1,
            text: 'current text',
            $: { id: 'paraTxt1' },
          },
        ],
      },
      {
        type: 'custom-code',
        version: 1,
        language: 'javascript',
        $: { id: 'codeId01' },
        children: [
          {
            type: 'text',
            version: 1,
            text: 'const x = 1;',
            $: { id: 'codeTxt1' },
          },
        ],
      },
      {
        type: 'list',
        version: 1,
        listType: 'check',
        start: 1,
        tag: 'ul',
        $: { id: 'listId01' },
        children: [
          {
            type: 'listitem',
            version: 1,
            value: 1,
            indent: 0,
            checked: true,
            $: { id: 'itemId01' },
            children: [
              { type: 'text', version: 1, text: 'done', $: { id: 'doneTxt1' } },
            ],
          },
        ],
      },
    ],
  },
});

test('History compares against the live native document as Source getSaveState does', () => {
  const source = behaviorEditor();
  source.editor.setEditorState(source.editor.parseEditorState(STORED));
  const expected = getSaveState(source.editor.getEditorState());

  const runtime = mount();
  onTestFinished(() => runtime.root.remove());
  onTestFinished(() => runtime.close());
  runtime.port.setState(STORED);

  expect(currentSavedState({ nativeRuntime: runtime })).toEqual(expected);
});
