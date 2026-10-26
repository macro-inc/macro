import { $isAutoLinkNode, $isLinkNode } from '@lexical/link';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import {
  ALL_TRANSFORMERS,
  INTERNAL_TRANSFORMERS,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import { $isUnlinkedTextNode } from '@macro-inc/lexical-core/nodes/UnlinkedTextNode';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';

import {
  findNextAutoLinkMatch,
  linksPlugin,
  normalizeLinkUrl,
  UNLINK_COMMAND,
} from './linksPlugin';

describe('normalizeLinkUrl', () => {
  it('normalizes bare hosts to HTTPS', () => {
    expect(normalizeLinkUrl(' example.com/path with spaces ')).toBe(
      'https://example.com/path%20with%20spaces'
    );
  });

  it('allows HTTP, HTTPS, and mailto links', () => {
    expect(normalizeLinkUrl('http://example.com/path')).toBe(
      'http://example.com/path'
    );
    expect(normalizeLinkUrl('https://example.com/path')).toBe(
      'https://example.com/path'
    );
    expect(normalizeLinkUrl('mailto:user@example.com')).toBe(
      'mailto:user@example.com'
    );
  });

  it.each([
    'javascript://alert(1)',
    'javascript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,unsafe',
    'file:///tmp/secret',
    'ftp://example.com',
  ])('rejects a disallowed URL scheme: %s', (url) => {
    expect(normalizeLinkUrl(url)).toBeNull();
  });

  it('rejects empty and malformed URLs', () => {
    expect(normalizeLinkUrl('')).toBeNull();
    expect(normalizeLinkUrl('https://')).toBeNull();
  });
});

describe('findNextAutoLinkMatch', () => {
  it('requires a protocol in protocol mode', () => {
    expect(findNextAutoLinkMatch('Visit example.com')).toBeNull();
    expect(findNextAutoLinkMatch('Visit https://example.rs')?.url).toBe(
      'https://example.rs'
    );
  });

  it('matches common bare TLDs in common-tlds mode', () => {
    expect(findNextAutoLinkMatch('Visit example.com', 'common-tlds')?.url).toBe(
      'https://example.com'
    );
    expect(findNextAutoLinkMatch('Visit macro.co', 'common-tlds')?.url).toBe(
      'https://macro.co'
    );
    expect(findNextAutoLinkMatch('Visit example.org', 'common-tlds')?.url).toBe(
      'https://example.org'
    );
  });

  it('does not match file-like non-curated TLDs in common-tlds mode', () => {
    expect(findNextAutoLinkMatch('Open main.rs', 'common-tlds')).toBeNull();
    expect(findNextAutoLinkMatch('Open parser.ts', 'common-tlds')).toBeNull();
    expect(findNextAutoLinkMatch('Open types.d.ts', 'common-tlds')).toBeNull();
  });

  it('keeps fuzzy mode available for callers that want broader matching', () => {
    expect(findNextAutoLinkMatch('Visit example.rs', 'fuzzy')?.url).toBe(
      'https://example.rs'
    );
  });
});

describe('composer link persistence', () => {
  it('removes an entire formatted label when multiple children are selected', () => {
    const editor = createEditor({
      nodes: SupportedNodeTypes,
      onError(error) {
        throw error;
      },
    });
    const cleanup = linksPlugin({})(editor);
    editor.update(
      () =>
        $convertFromMarkdownString(
          '[**click** here](https://example.com)',
          ALL_TRANSFORMERS
        ),
      { discrete: true }
    );
    editor.update(
      () => {
        const [first, last] = $getRoot().getAllTextNodes();
        const selection = first.select(0);
        selection.focus.set(last.getKey(), last.getTextContentSize(), 'text');
        expect(editor.dispatchCommand(UNLINK_COMMAND, undefined)).toBe(true);
      },
      { discrete: true }
    );
    const markdown = editor.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toBe('click here');
      for (const node of $getRoot().getAllTextNodes()) {
        expect($isLinkNode(node.getParent())).toBe(false);
      }
      return $convertToMarkdownString(INTERNAL_TRANSFORMERS);
    });
    expect(markdown).toBe('**click** here');
    cleanup();
  });

  it('keeps escaped URLs literal when imported into a live editor', () => {
    const editor = createEditor({
      nodes: SupportedNodeTypes,
      onError(error) {
        throw error;
      },
    });
    const cleanup = linksPlugin({ autoLinkMatchMode: 'common-tlds' })(editor);
    editor.update(
      () =>
        $convertFromMarkdownString(
          'https\\://example\\.com then https://example.com/linked',
          ALL_TRANSFORMERS
        ),
      { discrete: true }
    );
    editor.getEditorState().read(() => {
      const nodes = $getRoot().getAllTextNodes();
      expect($isUnlinkedTextNode(nodes[0])).toBe(true);
      expect(nodes[0].getTextContent()).toBe('https://example.com');
      expect($isLinkNode(nodes[0].getParent())).toBe(false);
      expect($isLinkNode(nodes[2].getParent())).toBe(true);
    });
    cleanup();
  });

  it.each([
    { kind: 'typed', url: 'https://example.com/a%20b', protocol: false },
    { kind: 'imported', url: 'https://example.com/a%20b', protocol: false },
    { kind: 'typed', url: 'example.com', protocol: false },
    { kind: 'imported', url: 'example.com', protocol: false },
    { kind: 'imported', url: 'example.com', protocol: true },
  ])(
    'keeps a $kind $url link removed after saving and opening the editor again',
    ({ kind, url, protocol }) => {
      const editor = createEditor({
        nodes: SupportedNodeTypes,
        onError(error) {
          throw error;
        },
      });
      const cleanup = linksPlugin({
        autoLinkMatchMode: protocol ? 'protocol' : 'common-tlds',
      })(editor);
      editor.update(
        () => {
          if (kind === 'typed') {
            $getRoot().append(
              $createParagraphNode().append(
                $createTextNode(url).setFormat('bold')
              )
            );
          } else {
            $convertFromMarkdownString(`**${url}**`, ALL_TRANSFORMERS);
          }
        },
        { discrete: true }
      );
      editor.getEditorState().read(() => {
        const node = $getRoot().getAllTextNodes()[0];
        expect(node.hasFormat('bold')).toBe(true);
        const parent = node.getParent();
        expect($isLinkNode(parent) && parent.getURL()).toBe(
          url.includes('://') ? url : `https://${url}`
        );
      });
      editor.update(
        () => {
          $getRoot().getAllTextNodes()[0].select();
          editor.dispatchCommand(UNLINK_COMMAND, undefined);
        },
        { discrete: true }
      );
      const markdown = editor
        .getEditorState()
        .read(() => $convertToMarkdownString(INTERNAL_TRANSFORMERS));
      editor.update(
        () => $convertFromMarkdownString(markdown, ALL_TRANSFORMERS),
        { discrete: true }
      );
      editor.getEditorState().read(() => {
        const node = $getRoot().getAllTextNodes()[0];
        expect($isUnlinkedTextNode(node)).toBe(true);
        expect(node.hasFormat('bold')).toBe(true);
        expect(node.getTextContent()).toBe(url);
        expect($isLinkNode(node.getParent())).toBe(false);
        expect($isAutoLinkNode(node.getParent())).toBe(false);
      });
      cleanup();
    }
  );
});
