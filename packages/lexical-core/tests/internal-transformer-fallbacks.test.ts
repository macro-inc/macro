import { $convertFromMarkdownString } from '@lexical/markdown';
import { $getRoot, $isParagraphNode, createEditor } from 'lexical';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import {
  $isUnknownMentionNode,
  type UnknownMentionNode,
} from '../nodes/UnknownMentionNode';
import { $isUserMentionNode } from '../nodes/UserMentionNode';
import { ALL_TRANSFORMERS } from '../transformers';

async function importMarkdown(markdown: string) {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });

  await new Promise<void>((resolve) => {
    editor.update(
      () => {
        $convertFromMarkdownString(markdown, ALL_TRANSFORMERS);
      },
      { onUpdate: () => resolve() }
    );
  });

  return editor;
}

function findUnknownMention(): UnknownMentionNode | null {
  const nodes = $getRoot().getAllTextNodes();
  for (const node of nodes) {
    const nextSibling = node.getNextSibling();
    if ($isUnknownMentionNode(nextSibling)) {
      return nextSibling;
    }
  }

  const rootChildren = $getRoot().getChildren();
  for (const child of rootChildren) {
    if ($isUnknownMentionNode(child)) {
      return child;
    }

    if ($isParagraphNode(child)) {
      for (const paragraphChild of child.getChildren()) {
        if ($isUnknownMentionNode(paragraphChild)) {
          return paragraphChild;
        }
      }
    }
  }

  return null;
}

describe('internal transformer fallbacks', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleError.mockRestore();
  });

  it('keeps valid user mentions as user mention nodes', async () => {
    const editor = await importMarkdown(
      '<m-user-mention>{"userId":"u1","email":"a@b.com"}</m-user-mention>'
    );

    editor.getEditorState().read(() => {
      const paragraph = $getRoot().getFirstChild();
      const node = $isParagraphNode(paragraph)
        ? paragraph.getFirstChild()
        : null;
      expect(node?.getType()).toBe('user-mention');
    });
  });

  it('ignores malformed user mention displayName values', async () => {
    const editor = await importMarkdown(
      '<m-user-mention>{"userId":"u1","email":"a@b.com","displayName":{"first":"A"}}</m-user-mention>'
    );

    editor.getEditorState().read(() => {
      const paragraph = $getRoot().getFirstChild();
      const node = $isParagraphNode(paragraph)
        ? paragraph.getFirstChild()
        : null;
      expect($isUserMentionNode(node)).toBe(true);
      expect(node?.getTextContent()).toBe('a');
    });
  });

  it.each([
    ['<m-user-mention>{bad}</m-user-mention>', 'Unknown User'],
    ['<m-user-mention>{"email":"a@b.com"}</m-user-mention>', 'Unknown User'],
    ['<m-katex-equation>{bad}</m-katex-equation>', 'Unknown Equation'],
    [
      '<m-katex-equation>{"equation":"x"}</m-katex-equation>',
      'Unknown Equation',
    ],
    ['<m-snapshot>{bad}</m-snapshot>', 'Unknown Snapshot'],
    ['<m-await>{bad}</m-await>', 'Unknown Await'],
    ['<m-magic-chip>{bad}</m-magic-chip>', 'Unknown Magic Chip'],
    [
      '<m-magic-chip>{"agentSessionId":"session","channelId":"channel","promptedMessage":{"turn":0,"author":"user"},"status":"invalid"}</m-magic-chip>',
      'Unknown Magic Chip',
    ],
    ['<m-link>{bad}</m-link>', 'Unknown Link'],
  ])(
    'falls back for malformed text transformer payload %#',
    async (markdown, name) => {
      const editor = await importMarkdown(markdown);

      editor.getEditorState().read(() => {
        const unknown = findUnknownMention();
        expect(unknown?.getName()).toBe(name);
      });
    }
  );

  it.each([
    '<m-agent-context>{bad}</m-agent-context>',
    '<m-agent-context>{"version":2,"text":"private"}</m-agent-context>',
    '<m-agent-context>{"version":1,"text":42}</m-agent-context>',
    '<m-agent-context>{"version":1,"text":"private","extra":true}</m-agent-context>',
  ])('rejects malformed trusted agent context %#', async (markdown) => {
    const editor = await importMarkdown(markdown);

    editor.getEditorState().read(() => {
      expect(findUnknownMention()?.getName()).toBe('Unknown Agent Context');
    });
  });

  it.each([
    ['<m-document-card>{bad}</m-document-card>', 'Unknown Item'],
    [
      '<m-document-card>{"documentName":"Doc"}</m-document-card>',
      'Unknown Item',
    ],
    ['<m-paste>{bad}</m-paste>', 'Unknown Paste'],
    ['<m-image>{bad}</m-image>', 'Unknown Image'],
    ['<m-image>{"alt":"missing url"}</m-image>', 'Unknown Image'],
    ['<m-video>{bad}</m-video>', 'Unknown Video'],
    ['<m-watermark>{bad}</m-watermark>', 'Unknown Watermark'],
    [
      '<m-email-thread-embed>{bad}</m-email-thread-embed>',
      'Unknown Email Thread',
    ],
  ])(
    'wraps malformed element transformer fallback in a paragraph %#',
    async (markdown, name) => {
      const editor = await importMarkdown(markdown);

      editor.getEditorState().read(() => {
        const firstChild = $getRoot().getFirstChild();
        expect($isParagraphNode(firstChild)).toBe(true);

        const unknown = findUnknownMention();
        expect(unknown?.getName()).toBe(name);
      });
    }
  );
});
