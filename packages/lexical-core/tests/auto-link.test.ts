import { $createAutoLinkNode, $isLinkNode } from '@lexical/link';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type Transformer,
} from '@lexical/markdown';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  createEditor,
  type LexicalNode,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import {
  $createUnlinkedTextNode,
  $isUnlinkedTextNode,
} from '../nodes/UnlinkedTextNode';
import {
  ALL_TRANSFORMERS,
  EXTERNAL_TRANSFORMERS,
  INTERNAL_TRANSFORMERS,
} from '../transformers';
import { findNextAutoLinkMatch, normalizeLinkUrl } from '../utils/auto-link';

function parse(
  markdown: string,
  transformers: Transformer[] = ALL_TRANSFORMERS
) {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError(error) {
      throw error;
    },
  });
  editor.update(() => $convertFromMarkdownString(markdown, transformers), {
    discrete: true,
  });
  return editor;
}

function links(node: LexicalNode): { text: string; url: string }[] {
  const own = $isLinkNode(node)
    ? [{ text: node.getTextContent(), url: node.getURL() }]
    : [];
  return [
    ...own,
    ...($isElementNode(node) ? node.getChildren().flatMap(links) : []),
  ];
}

const appStore = 'https://apps.apple.com/us/app/macro-app/id6743133649';

describe('Markdown URL imports', () => {
  it.each([
    { transformers: ALL_TRANSFORMERS },
    { transformers: INTERNAL_TRANSFORMERS },
    { transformers: EXTERNAL_TRANSFORMERS },
  ])(
    'links the original agent message through every import format',
    ({ transformers }) => {
      const message = `hey! can you rate the Macro app on the App Store (5 stars if you're feeling it) and leave a quick review if you can? takes 30 seconds:\n${appStore}\n\n(sent by @macro on behalf of Jacob)`;
      const editor = parse(message, transformers);
      editor.getEditorState().read(() => {
        expect(links($getRoot())).toEqual([{ text: appStore, url: appStore }]);
        expect($getRoot().getTextContent()).toContain(
          '(sent by @macro on behalf of Jacob)'
        );
      });
    }
  );
  it.each([
    [
      'Visit https://example.com/a%20b?q=x%2Fy#part.',
      'https://example.com/a%20b?q=x%2Fy#part',
    ],
    ['Visit (https://example.com/a(b)).', 'https://example.com/a(b)'],
    ['https://example.com/a~~b~~c', 'https://example.com/a~~b~~c'],
    [
      'https://example.com/?q=*abc*&next=1',
      'https://example.com/?q=*abc*&next=1',
    ],
    ['<https://example.com/path>', 'https://example.com/path'],
    ['Go to example.com/path', 'https://example.com/path'],
    ['Email hello@example.com.', 'mailto:hello@example.com'],
  ])('keeps the URL intact in %s', (markdown, url) => {
    parse(markdown)
      .getEditorState()
      .read(() =>
        expect(links($getRoot()).map((link) => link.url)).toEqual([url])
      );
  });
  it('preserves bold around a URL without formatting punctuation inside it', () => {
    parse('**https://example.com/a~~b~~c**')
      .getEditorState()
      .read(() => {
        expect(links($getRoot())).toEqual([
          {
            text: 'https://example.com/a~~b~~c',
            url: 'https://example.com/a~~b~~c',
          },
        ]);
        expect($getRoot().getAllTextNodes()[0].hasFormat('bold')).toBe(true);
        expect($getRoot().getAllTextNodes()[0].hasFormat('strikethrough')).toBe(
          false
        );
      });
  });
  it('links multiple URLs, including those after unsupported schemes', () => {
    parse(
      'ftp://files.example.com https://one.example.com, https://two.example.com.'
    )
      .getEditorState()
      .read(() => {
        expect(links($getRoot()).map((link) => link.url)).toEqual([
          'https://one.example.com',
          'https://two.example.com',
        ]);
      });
  });
  it.each([
    '`https://example.com`',
    '```text\nhttps://example.com\n```',
    'Open main.rs or parser.ts',
    'javascript:alert(1)',
    'https\\://example\\.com',
    'https://example\\.com',
    'https://example\\.com/a\\_b',
    'https://example.com/a\\\\b\\_c',
    '<m-user-mention>{"userId":"u1","email":"hello@example.com","displayName":"https://example.com"}</m-user-mention>',
    '![https://label.example.com](https://image.example.com/image.png)',
  ])('keeps protected content inert: %s', (markdown) => {
    parse(markdown)
      .getEditorState()
      .read(() => expect(links($getRoot())).toEqual([]));
  });
  it('links a URL whose only escapes are formatting escapes', () => {
    parse('Read https://example.com/post?a=x\\_y\\*z\\~w&s=20 later')
      .getEditorState()
      .read(() => {
        expect(links($getRoot())).toEqual([
          {
            text: 'https://example.com/post?a=x_y*z~w&s=20',
            url: 'https://example.com/post?a=x_y*z~w&s=20',
          },
        ]);
        expect($getRoot().getTextContent()).toBe(
          'Read https://example.com/post?a=x_y*z~w&s=20 later'
        );
      });
  });
  it('saves plain-text URLs that load as links, keeping their formatting', () => {
    const url = 'https://example.com/post?a=x_y&s=20';
    const italicUrl = 'https://example.com/a*b';
    const editor = parse('');
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append(
            $createParagraphNode().append(
              $createTextNode(`snake_case ${url} and `),
              $createTextNode(italicUrl).setFormat('italic')
            )
          );
      },
      { discrete: true }
    );
    const markdown = editor
      .getEditorState()
      .read(() => $convertToMarkdownString(INTERNAL_TRANSFORMERS));
    // Formatted text keeps its escapes so a `*` in the URL cannot close the
    // italic; import links it anyway.
    expect(markdown).toBe(
      `snake\\_case ${url} and *https://example.com/a\\*b*`
    );
    parse(markdown)
      .getEditorState()
      .read(() => {
        expect(links($getRoot())).toEqual([
          { text: url, url },
          { text: italicUrl, url: italicUrl },
        ]);
        expect($getRoot().getAllTextNodes()[3].hasFormat('italic')).toBe(true);
      });
  });
  it('does not nest links inside explicit Markdown or internal links', () => {
    parse(
      '[https://label.example.com](https://target.example.com) <m-link>{"url":"https://xml.example.com","text":"https://label.example.com"}</m-link>'
    )
      .getEditorState()
      .read(() => {
        expect(links($getRoot())).toEqual([
          {
            text: 'https://label.example.com',
            url: 'https://target.example.com',
          },
          { text: 'https://label.example.com', url: 'https://xml.example.com' },
        ]);
      });
  });
  it('retains URL destinations through repeated save and reload', () => {
    let editor = parse(`${appStore} https://example.com/a%2Fb?q=%25`);
    for (let i = 0; i < 3; i++) {
      const markdown = editor
        .getEditorState()
        .read(() => $convertToMarkdownString(INTERNAL_TRANSFORMERS));
      editor = parse(markdown);
      editor
        .getEditorState()
        .read(() =>
          expect(links($getRoot()).map((link) => link.url)).toEqual([
            appStore,
            'https://example.com/a%2Fb?q=%25',
          ])
        );
    }
  });
});

describe('explicitly removed links', () => {
  it('stores a normalized destination for older clients of an unlinked bare host', () => {
    const editor = parse('');
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append(
            $createParagraphNode().append(
              $createUnlinkedTextNode('example.com')
            )
          );
      },
      { discrete: true }
    );
    const markdown = editor
      .getEditorState()
      .read(() => $convertToMarkdownString(INTERNAL_TRANSFORMERS));
    expect(markdown).toContain('"url":"https://example.com"');
    const legacyMarkdown = markdown.replace(',"unlinked":true,"format":0', '');
    parse(legacyMarkdown)
      .getEditorState()
      .read(() =>
        expect(links($getRoot())).toEqual([
          { text: 'example.com', url: 'https://example.com' },
        ])
      );
  });

  it.each(['text', 'autolink'])(
    'keeps an unlinked %s URL inert after save and reload',
    (kind) => {
      const editor = parse('');
      editor.update(
        () => {
          const text = $createTextNode(appStore).setFormat('bold');
          const node =
            kind === 'text'
              ? $createUnlinkedTextNode(appStore).setFormat('bold')
              : $createAutoLinkNode(appStore, { isUnlinked: true }).append(
                  text
                );
          $getRoot().clear().append($createParagraphNode().append(node));
        },
        { discrete: true }
      );
      const markdown = editor
        .getEditorState()
        .read(() => $convertToMarkdownString(INTERNAL_TRANSFORMERS));
      const restored = parse(markdown);
      restored.getEditorState().read(() => {
        expect(links($getRoot())).toEqual([]);
        const node = $getRoot().getAllTextNodes()[0];
        expect($isUnlinkedTextNode(node)).toBe(true);
        expect(node.getTextContent()).toBe(appStore);
        expect(node.hasFormat('bold')).toBe(true);
      });
      const savedAgain = restored
        .getEditorState()
        .read(() => $convertToMarkdownString(INTERNAL_TRANSFORMERS));
      expect(savedAgain).toBe(markdown);
    }
  );
  it('preserves text and formatting through serialized editor state', () => {
    const editor = parse('');
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(
            $createUnlinkedTextNode(appStore).setFormat('italic')
          )
        );
      },
      { discrete: true }
    );
    editor.parseEditorState(editor.getEditorState().toJSON()).read(() => {
      const node = $getRoot().getAllTextNodes()[0];
      expect(node.hasFormat('italic')).toBe(true);
      expect($isUnlinkedTextNode(node)).toBe(true);
    });
  });
  it.each([appStore, 'https://example.com/a_b?c=d'])(
    'exports literal text to external Markdown without internal tags or links: %s',
    (url) => {
      const editor = parse(
        `<m-link>{"url":"${url}","text":"${url}","unlinked":true}</m-link>`
      );
      const markdown = editor
        .getEditorState()
        .read(() => $convertToMarkdownString(EXTERNAL_TRANSFORMERS));
      expect(markdown).not.toContain('<m-link>');
      parse(markdown, EXTERNAL_TRANSFORMERS)
        .getEditorState()
        .read(() => {
          expect(links($getRoot())).toEqual([]);
          expect($getRoot().getTextContent()).toBe(url);
        });
    }
  );
});

describe('shared URL recognition', () => {
  it.each([
    'https://example.com/a%20b',
    'https://example.com/a%2Fb?q=x%25#y',
    'https://example.com/a%2520b',
  ])('normalizes encoded URLs idempotently: %s', (url) => {
    expect(normalizeLinkUrl(url)).toBe(url);
    expect(normalizeLinkUrl(normalizeLinkUrl(url) ?? '')).toBe(url);
  });
  it('continues past an unsupported URL to find an allowed URL', () => {
    expect(
      findNextAutoLinkMatch('ftp://example.com then https://example.com/ok')
        ?.url
    ).toBe('https://example.com/ok');
  });
});
