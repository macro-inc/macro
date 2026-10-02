import { $isLinkNode } from '@lexical/link';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import {
  $getRoot,
  $isElementNode,
  createEditor,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import fixtures from '../../../crates/slack_integration/tests/fixtures/native-message-links.json';
import { SupportedNodeTypes } from '../node-list';
import { INTERNAL_TRANSFORMERS } from '../transformers';

function editor(): LexicalEditor {
  return createEditor({
    nodes: SupportedNodeTypes,
    onError(error) {
      throw error;
    },
  });
}

function importMarkdown(markdown: string): LexicalEditor {
  const result = editor();
  result.update(
    () => $convertFromMarkdownString(markdown, INTERNAL_TRANSFORMERS),
    { discrete: true }
  );
  return result;
}

function activeNodes(node: LexicalNode): LexicalNode[] {
  const children = $isElementNode(node) ? node.getChildren() : [];
  const active = ['link', 'user-mention', 'document-mention'].includes(
    node.getType()
  );
  return [...(active ? [node] : []), ...children.flatMap(activeNodes)];
}

function assertFixture(
  result: LexicalEditor,
  fixture: (typeof fixtures)[number],
  expectedUrl = fixture.payload?.url
): void {
  result.getEditorState().read(() => {
    const nodes = activeNodes($getRoot());
    if (fixture.kind === 'inert') {
      expect(nodes).toHaveLength(0);
      return;
    }
    expect(nodes).toHaveLength(1);
    const node = nodes[0];
    expect(node.getType()).toBe(fixture.kind);
    if ($isLinkNode(node)) {
      expect(node.getURL()).toBe(expectedUrl);
      expect(node.getTitle() ?? '').toBe('');
      expect(node.getTextContent()).toBe(fixture.payload?.text);
    } else {
      expect(node.exportJSON()).toMatchObject(fixture.payload ?? {});
    }
  });
}

describe('Rust Slack import native message fixtures', () => {
  it.each(fixtures)(
    '$name imports with the real internal transformers',
    (fixture) => {
      const imported = importMarkdown(fixture.native);
      assertFixture(imported, fixture);

      // Exercise actual Lexical state serialization/deserialization, including
      // labels containing newlines, closing/nested tags, quotes and backslashes.
      const restored = editor();
      restored.setEditorState(
        restored.parseEditorState(
          JSON.stringify(imported.getEditorState().toJSON())
        )
      );
      assertFixture(restored, fixture);
    }
  );

  it.each(['mailto', 'user', 'channel', 'root', 'reply'])(
    '%s also round-trips through native markdown export',
    (name) => {
      const fixture = fixtures.find((entry) => entry.name === name);
      if (!fixture) throw new Error(`Missing fixture ${name}`);
      const imported = importMarkdown(fixture.native);
      const markdown = imported
        .getEditorState()
        .read(() => $convertToMarkdownString(INTERNAL_TRANSFORMERS));
      assertFixture(importMarkdown(markdown), fixture);
    }
  );

  it('round-trips external links through markdown with Lexical URL escaping', () => {
    const fixture = fixtures.find((entry) => entry.name === 'external');
    if (!fixture?.payload?.url) throw new Error('Missing external fixture');
    const imported = importMarkdown(fixture.native);
    const markdown = imported
      .getEditorState()
      .read(() => $convertToMarkdownString(INTERNAL_TRANSFORMERS));
    assertFixture(
      importMarkdown(markdown),
      fixture,
      fixture.payload.url.replaceAll('(', '%28').replaceAll(')', '%29')
    );
  });

  it('keeps emphasis around generated links without formatting their JSON labels', () => {
    const fixture = fixtures.find((entry) => entry.name === 'external');
    if (!fixture) throw new Error('Missing external fixture');
    const imported = importMarkdown(`**${fixture.native}**`);
    assertFixture(imported, fixture);
    imported.getEditorState().read(() => {
      expect($getRoot().getAllTextNodes()[0].hasFormat('bold')).toBe(true);
    });
  });
});
