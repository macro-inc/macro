import { $isLinkNode } from '@lexical/link';
import {
  $convertFromMarkdownString,
  type Transformer,
} from '@lexical/markdown';
import {
  $getRoot,
  $isElementNode,
  createEditor,
  type LexicalNode,
  type SerializedEditorState,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import {
  ALL_TRANSFORMERS,
  EXTERNAL_TRANSFORMERS,
  INTERNAL_TRANSFORMERS,
} from '../transformers';
import { serializedEditorStateToMarkdown } from '../utils/markdown-state';

function linksIn(markdown: string, transformers: Transformer[]) {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError(error) {
      throw error;
    },
  });
  editor.update(() => $convertFromMarkdownString(markdown, transformers), {
    discrete: true,
  });
  return editor.getEditorState().read(() => {
    const links: string[] = [];
    const visit = (node: LexicalNode) => {
      if ($isLinkNode(node)) links.push(node.getURL());
      if ($isElementNode(node)) node.getChildren().forEach(visit);
    };
    visit($getRoot());
    return { links, text: $getRoot().getTextContent() };
  });
}

const mLink = (url: string) =>
  `See <m-link>${JSON.stringify({ url, text: 'the notes', title: '' })}</m-link> today`;

// Each spelling a browser reads as a script or document URL.
const ACTIVE_URLS = [
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  ' javascript:alert(1)',
  '\u0001javascript:alert(1)',
  'java\tscript:alert(1)',
  'java\nscript:alert(1)',
  'vbscript:msgbox(1)',
  'data:text/html,<script>alert(1)</script>',
];

const LINKABLE_URLS = [
  'https://example.com/a?b=c#d',
  'http://example.com',
  'mailto:someone@example.com',
  'tel:100',
  'sms:100',
  '/app/md/2b6a1f0e',
  '#heading',
];

describe('saved links whose URL a link may not open', () => {
  it.each([
    ['all', ALL_TRANSFORMERS],
    ['internal', INTERNAL_TRANSFORMERS],
  ] as const)('import an m-link as its text (%s transformers)', (_, set) => {
    for (const url of ACTIVE_URLS) {
      expect(linksIn(mLink(url), [...set]), url).toEqual({
        links: [],
        text: 'See the notes today',
      });
    }
  });

  it.each([
    ['all', ALL_TRANSFORMERS],
    ['internal', INTERNAL_TRANSFORMERS],
    ['external', EXTERNAL_TRANSFORMERS],
  ] as const)(
    'import a Markdown link as its text (%s transformers)',
    (_, set) => {
      // A Markdown destination can't hold a bare parenthesis.
      for (const destination of [
        'javascript:alert%281%29',
        'JAVASCRIPT:alert%281%29',
        'javascript\\:alert%281%29',
        '&#106;avascript:alert%281%29',
        'data:text/html,hi',
      ]) {
        expect(
          linksIn(`See [the notes](${destination}) today`, [...set]),
          destination
        ).toEqual({ links: [], text: 'See the notes today' });
      }
    }
  );

  it('keeps web, mail and relative links', () => {
    for (const url of LINKABLE_URLS) {
      expect(linksIn(mLink(url), ALL_TRANSFORMERS).links, url).toEqual([url]);
      expect(
        linksIn(`See [the notes](${url}) today`, ALL_TRANSFORMERS).links,
        url
      ).toEqual([url]);
    }
  });
});

describe('saved mentions whose URL a link may not open', () => {
  const mention = (node: Record<string, unknown>): SerializedEditorState =>
    ({
      root: {
        type: 'root',
        version: 1,
        direction: null,
        format: '',
        indent: 0,
        children: [
          {
            type: 'paragraph',
            version: 1,
            direction: null,
            format: '',
            indent: 0,
            textFormat: 0,
            textStyle: '',
            children: [node],
          },
        ],
      },
    }) as unknown as SerializedEditorState;

  it('drops it from a pull request mention in Lexical JSON', () => {
    const markdown = serializedEditorStateToMarkdown(
      mention({
        type: 'pr-mention',
        version: 1,
        id: 'pr-1',
        label: 'macro#1',
        url: 'javascript:alert(1)',
      })
    );
    expect(markdown).toContain('"id":"pr-1"');
    expect(markdown).not.toContain('javascript');
  });

  it('replaces it in a booking link mention in Lexical JSON', () => {
    const markdown = serializedEditorStateToMarkdown(
      mention({
        type: 'booking-link-mention',
        version: 1,
        profileId: 'profile-1',
        url: 'javascript:alert(1)',
      })
    );
    expect(markdown).toContain('/app/book/profile-1');
    expect(markdown).not.toContain('javascript');
  });
});
