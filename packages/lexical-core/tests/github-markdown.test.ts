import { $isCodeNode } from '@lexical/code';
import { $isLinkNode } from '@lexical/link';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  createEditor,
  type LexicalNode,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { StaticRenderNodeTypes, SupportedNodeTypes } from '../node-list';
import {
  $isDetailsNode,
  $isDetailsSummaryNode,
  type DetailsNode,
} from '../nodes/DetailsNode';
import { ALL_TRANSFORMERS } from '../transformers';
import { normalizeGithubMarkdown } from '../utils/github-markdown';

const ICON =
  'https://storage.googleapis.com/coderabbit_public_assets/review-comment-icons-v1/bot.svg';

/** A CodeRabbit review comment in the shape its bot posts. */
const CODERABBIT_COMMENT = `<!-- coderabbit-ai-generated:v1 -->

**<picture><img src="${ICON}" width="16" height="16" align="absmiddle" alt=""></picture> Minor** · **Functional Correctness**

**Load later pages when the visible entries are fewer than the limit.**

<details>
<summary><picture><source media="(prefers-color-scheme: dark)" srcset="${ICON}"><img src="${ICON}" width="16" height="16" alt=""></picture> Prompt for AI Agents</summary>
<dl>
<dd>
<br>

\`\`\`
Review comment at <details> around lines 113 - 118
\`\`\`

</dd>
</dl>
</details>

<h6>
<details>
<summary>Review info</summary>
<dl>
<dd>

- **Repository**: [org/repo](<https://github.com/org/repo>)

<details>
<summary><strong>Merge Risk:</strong> <strong><picture><img src="${ICON}" width="16" height="16" alt=""></picture> Low</strong> · up to <code>b215c</code></summary>

Nested body.

</details>

</dd>
</dl>
</details>
</h6>

- [ ] <!-- {"checkboxId":"1"} --> Fix comments

<!-- This is an auto-generated comment by CodeRabbit -->`;

function importMarkdown(markdown: string, nodes = StaticRenderNodeTypes) {
  const editor = createEditor({
    nodes,
    onError: (error) => {
      throw error;
    },
  });
  const transformers = ALL_TRANSFORMERS.filter(
    (transformer) =>
      !('dependencies' in transformer) ||
      transformer.dependencies.every((node) => editor.hasNode(node))
  );
  editor.update(() => $convertFromMarkdownString(markdown, transformers), {
    discrete: true,
  });
  return { editor, transformers };
}

function collect<T extends LexicalNode>(
  node: LexicalNode,
  guard: (node: LexicalNode) => node is T
): T[] {
  const found = guard(node) ? [node] : [];
  if (!$isElementNode(node)) return found;
  return found.concat(
    ...node.getChildren().map((child) => collect(child, guard))
  );
}

function texts(node: LexicalNode): string[] {
  return collect(node, $isTextNode).map((text) => text.getTextContent());
}

describe('normalizeGithubMarkdown', () => {
  it('drops marker comments, wrapper tags and decorative icons', () => {
    const markdown = normalizeGithubMarkdown(CODERABBIT_COMMENT);
    expect(markdown).not.toMatch(/<!--|<\/?(?:dl|dd|picture|source|img|h6)\b/);
    expect(markdown).toContain('**Minor** · **Functional Correctness**');
    expect(markdown).toContain('<summary>Prompt for AI Agents</summary>');
    expect(markdown).toContain('[org/repo](https://github.com/org/repo)');
    expect(markdown).toContain(
      '<summary>**Merge Risk:** **Low** · up to `b215c`</summary>'
    );
    expect(markdown).toContain('- [ ] Fix comments');
  });

  it('leaves fenced code and code spans as written', () => {
    const markdown = normalizeGithubMarkdown(
      '`<br>` and <b>bold</b>\n\n```html\n<div><!-- kept --></div>\n```'
    );
    expect(markdown).toBe(
      '`<br>` and **bold**\n\n```html\n<div><!-- kept --></div>\n```'
    );
  });

  it('keeps content images and links them when inline', () => {
    expect(
      normalizeGithubMarkdown(
        '<p align="center"><img width="600" alt="Screenshot" src="https://example.com/a.png"></p>'
      )
    ).toBe('![Screenshot](https://example.com/a.png)');
    expect(
      normalizeGithubMarkdown('See ![chart](https://example.com/c.png) here')
    ).toBe('See [chart](https://example.com/c.png) here');
    expect(normalizeGithubMarkdown(`| ![Warning](${ICON}) |`)).toBe(
      '| Warning |'
    );
  });

  it('converts links, headings, rules, lists and alerts', () => {
    expect(
      normalizeGithubMarkdown(
        '<h3>Title</h3>\n<a href="https://example.com?a=1&amp;b=2">site</a><hr><ul><li>one</li><li>two</li></ul>\n\n> [!WARNING]\n> Careful'
      )
    ).toBe(
      '### Title\n\n[site](https://example.com?a=1&b=2)\n\n---\n\n- one\n\n- two\n\n> **Warning**\n> Careful'
    );
  });
});

describe('GitHub details sections', () => {
  it('import as collapsible nodes, nested, with code kept literal', () => {
    const { editor } = importMarkdown(
      normalizeGithubMarkdown(CODERABBIT_COMMENT)
    );
    editor.read(() => {
      const root = $getRoot();
      const details = collect(root, $isDetailsNode);
      expect(details).toHaveLength(3);

      const summaries = details.map((node) => {
        const summary = node.getFirstChild();
        expect($isDetailsSummaryNode(summary)).toBe(true);
        return summary?.getTextContent();
      });
      expect(summaries).toEqual([
        'Prompt for AI Agents',
        'Review info',
        'Merge Risk: Low · up to b215c',
      ]);

      const [prompt, info] = details as [DetailsNode, DetailsNode];
      const code = collect(prompt, $isCodeNode);
      expect(code.map((node) => node.getTextContent())).toEqual([
        'Review comment at <details> around lines 113 - 118',
      ]);
      expect(collect(info, $isDetailsNode)).toHaveLength(2);
      expect(collect(info, $isLinkNode).map((link) => link.getURL())).toContain(
        'https://github.com/org/repo'
      );
      expect(texts(root).join('')).not.toMatch(/<\/?(?:dl|dd|summary|img)/);
    });
  });

  it('honors `open` and labels a section without a summary', () => {
    const { editor } = importMarkdown('<details open>\n\nBody\n\n</details>');
    editor.read(() => {
      const [details] = collect($getRoot(), $isDetailsNode);
      expect(details?.isOpen()).toBe(true);
      expect(details?.getFirstChild()?.getTextContent()).toBe('Details');
    });
  });

  it('round-trips through Markdown export', () => {
    const source =
      '<details>\n<summary>**Summary**</summary>\n\nBody text\n\n</details>';
    const { editor, transformers } = importMarkdown(source);
    let exported = '';
    editor.read(() => {
      exported = $convertToMarkdownString(transformers);
    });
    expect(exported).toBe(source);
  });

  it('stay text when an unfiltered set runs in an editor without them', () => {
    const editor = createEditor({
      nodes: SupportedNodeTypes,
      onError: (error) => {
        throw error;
      },
    });
    editor.update(
      () =>
        $convertFromMarkdownString(
          '<details>\n<summary>Hi</summary>\n\nBody\n\n</details>',
          ALL_TRANSFORMERS
        ),
      { discrete: true }
    );
    editor.read(() => {
      expect(collect($getRoot(), $isDetailsNode)).toHaveLength(0);
      expect($getRoot().getTextContent()).toContain('Body');
    });
  });

  it('stay text in editors that do not register the details nodes', () => {
    const { editor } = importMarkdown(
      '<details>\n<summary>Hi</summary>\n\nBody\n\n</details>',
      SupportedNodeTypes
    );
    editor.read(() => {
      expect(collect($getRoot(), $isDetailsNode)).toHaveLength(0);
    });
  });
});
