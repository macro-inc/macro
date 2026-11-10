// @vitest-environment jsdom
import { MagicChipNode } from '@macro-inc/lexical-core';
import { $getRoot, createEditor } from 'lexical';
import { expect, test } from 'vitest';
import { initializeLexical } from '../../init';

initializeLexical();

test('Source parser retains admitted Magic values beyond its declared prop shape', () => {
  const editor = createEditor({
    nodes: [MagicChipNode],
    onError(error) {
      throw error;
    },
  });
  const state = editor.parseEditorState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        format: '',
        indent: 0,
        direction: null,
        children: [
          {
            type: 'magic-chip',
            version: 5,
            agentSessionId: 'fixture-agent',
            channelId: null,
            promptedMessage: [0, 'user'],
            status: 'no_messages',
          },
        ],
      },
    })
  );
  state.read(
    () => {
      const node = $getRoot().getFirstChild();
      if (!(node instanceof MagicChipNode))
        throw new Error('Missing actual parsed MagicChip');
      const props = node.exportComponentProps();
      expect(props.channelId).toBeNull();
      expect(Array.isArray(props.promptedMessage)).toBe(true);
      expect(JSON.stringify(props.promptedMessage)).toBe('[0,"user"]');
      expect(typeof node.decorate(editor, editor._config)).toBe('function');
    },
    { editor }
  );
});
