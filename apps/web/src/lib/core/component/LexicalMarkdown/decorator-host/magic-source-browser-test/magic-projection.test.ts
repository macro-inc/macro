// @vitest-environment jsdom
import { MagicChipNode } from '@macro-inc/lexical-core';
import { $getRoot, createEditor } from 'lexical';
import { expect, test } from 'vitest';
import { projectMagicChipData } from '../magic-projection';

test.each(['missing', 'null'])(
  'actual Source %s promptedMessage survives projection',
  (kind) => {
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
              status: 'no_messages',
              ...(kind === 'null' ? { promptedMessage: null } : {}),
            },
          ],
        },
      })
    );
    state.read(
      () => {
        const node = $getRoot().getFirstChild();
        if (!(node instanceof MagicChipNode))
          throw new Error('Missing actual Source Magic node');
        const source = node.exportComponentProps();
        expect(Object.hasOwn(source, 'promptedMessage')).toBe(true);
        expect(source.promptedMessage).toBe(kind === 'null' ? null : undefined);
        expect(Object.hasOwn(source, 'channelId')).toBe(false);
        const json: unknown = JSON.parse(JSON.stringify(node.exportJSON()));
        if (kind === 'missing')
          expect(json).not.toHaveProperty('promptedMessage');
        else expect(json).toHaveProperty('promptedMessage', null);
        const projected = projectMagicChipData(source);
        expect(projected).toEqual(source);
        expect(Object.hasOwn(projected, 'promptedMessage')).toBe(true);
        expect(Object.hasOwn(projected, 'channelId')).toBe(false);
      },
      { editor }
    );
  }
);
