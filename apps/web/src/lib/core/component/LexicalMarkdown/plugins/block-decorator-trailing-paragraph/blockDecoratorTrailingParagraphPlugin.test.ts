/**
 * @vitest-environment jsdom
 */

import {
  $createReplyTargetNode,
  ReplyTargetNode,
} from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $getRoot,
  $isParagraphNode,
  createEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { blockDecoratorTrailingParagraphPlugin } from './blockDecoratorTrailingParagraphPlugin';

const quoteReplyData = {
  channelId: 'channel-1',
  targetMessageId: 'message-1',
  targetThreadId: 'thread-1',
  displayText: 'Reply preview',
  senderId: 'sender-1',
};

function createTestEditor() {
  const editor = createEditor({
    namespace: 'block-decorator-trailing-paragraph-test',
    nodes: [ReplyTargetNode],
    onError: (error) => {
      throw error;
    },
  });
  const cleanup = blockDecoratorTrailingParagraphPlugin()(editor);
  return { editor, cleanup };
}

describe('blockDecoratorTrailingParagraphPlugin', () => {
  it('adds a paragraph after a trailing block decorator', () => {
    const { editor, cleanup } = createTestEditor();

    editor.update(
      () => {
        $getRoot().append($createReplyTargetNode(quoteReplyData));
      },
      { discrete: true }
    );

    editor.read(() => {
      const children = $getRoot().getChildren();
      expect(children).toHaveLength(2);
      expect(children[0]).toBeInstanceOf(ReplyTargetNode);
      expect($isParagraphNode(children[1])).toBe(true);
    });

    cleanup();
  });

  it('recreates the caret target when its paragraph is deleted', () => {
    const { editor, cleanup } = createTestEditor();

    editor.update(
      () => {
        $getRoot().append(
          $createReplyTargetNode(quoteReplyData),
          $createParagraphNode()
        );
      },
      { discrete: true }
    );
    editor.update(
      () => {
        $getRoot().getLastChild()?.remove();
      },
      { discrete: true }
    );

    editor.read(() => {
      const children = $getRoot().getChildren();
      expect(children).toHaveLength(2);
      expect($isParagraphNode(children[1])).toBe(true);
    });

    cleanup();
  });

  it('does not add another paragraph when one already trails the decorator', () => {
    const { editor, cleanup } = createTestEditor();

    editor.update(
      () => {
        $getRoot().append(
          $createReplyTargetNode(quoteReplyData),
          $createParagraphNode()
        );
      },
      { discrete: true }
    );

    editor.read(() => {
      expect($getRoot().getChildren()).toHaveLength(2);
    });

    cleanup();
  });
});
