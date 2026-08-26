import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type ElementTransformer,
  TRANSFORMERS,
  type Transformer,
} from '@lexical/markdown';
import {
  $createParagraphNode,
  $isParagraphNode,
  type ElementNode,
  type LexicalNode,
} from 'lexical';
import {
  $createCollapsibleContainerNode,
  $createCollapsibleContentNode,
  $createCollapsibleTitleNode,
  $isCollapsibleContainerNode,
  CollapsibleContainerNode,
  CollapsibleContentNode,
  type CollapsibleHeading,
  CollapsibleTitleNode,
  isCollapsibleHeading,
} from '../nodes/collapsible';
import { HTML_BLOCKQUOTE, I_MACRO_QUOTE } from './classedBlock';
import { CUSTOM_TRANSFORMERS } from './customTransformers';
import { I_HTML_RENDER } from './htmlRender';
import { I_IMAGE_CONSTRAINED, IMAGE } from './image';
import { I_EQUATION_NODE } from './katex';
import {
  E_CONTACT_MENTION,
  E_DOCUMENT_MENTION,
  E_USER_MENTION,
  I_CONTACT_MENTION,
  I_DATE_MENTION,
  I_DOCUMENT_MENTION,
  I_GROUP_MENTION,
  I_PR_MENTION,
  I_TAG_MENTION,
  I_THEME_MENTION,
  I_USER_MENTION,
} from './mentions';
import { E_TABLE_NODE, I_TABLE_NODE } from './tables';
import { HR } from './transformers';
import {
  replaceElementWithUnknownMention,
  UnknownMentionNode,
} from './unknownFallback';
import { UNKNOWN_MENTION } from './unknownMention';
import { I_VIDEO } from './video';

function escapeAngleBrackets(value: string): string {
  return value.replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

const TITLE_TRANSFORMERS: Transformer[] = [
  I_USER_MENTION,
  I_DOCUMENT_MENTION,
  I_CONTACT_MENTION,
  I_EQUATION_NODE,
  ...TRANSFORMERS,
];

function collapsibleInternalBodyTransformers(): Transformer[] {
  return [
    I_COLLAPSIBLE_NODE,
    I_TABLE_NODE,
    HTML_BLOCKQUOTE,
    I_MACRO_QUOTE,
    I_HTML_RENDER,
    HR,
    I_VIDEO,
    I_IMAGE_CONSTRAINED,
    IMAGE,
    I_USER_MENTION,
    I_GROUP_MENTION,
    I_DOCUMENT_MENTION,
    I_PR_MENTION,
    I_CONTACT_MENTION,
    I_DATE_MENTION,
    I_EQUATION_NODE,
    I_THEME_MENTION,
    I_TAG_MENTION,
    ...CUSTOM_TRANSFORMERS,
    UNKNOWN_MENTION,
  ];
}

function collapsibleExternalBodyTransformers(): Transformer[] {
  return [
    E_COLLAPSIBLE_NODE,
    E_TABLE_NODE,
    HTML_BLOCKQUOTE,
    E_USER_MENTION,
    E_DOCUMENT_MENTION,
    E_CONTACT_MENTION,
    ...CUSTOM_TRANSFORMERS,
  ];
}

function headingPrefix(heading: CollapsibleHeading): string {
  switch (heading) {
    case 'h1':
      return '# ';
    case 'h2':
      return '## ';
    case 'h3':
      return '### ';
    default:
      return '';
  }
}

function $exportTitleMarkdown(title: CollapsibleTitleNode): string {
  // Title children are inline (text/mentions), not top-level blocks, so the
  // markdown exporter would skip them. Plain text is enough for the summary.
  return title.getTextContent().trim();
}

function $fillTitleFromMarkdown(
  title: CollapsibleTitleNode,
  markdown: string
): void {
  const trimmed = markdown.trim();
  if (!trimmed) return;
  $convertFromMarkdownString(trimmed, TITLE_TRANSFORMERS, title);
  // Element transformers may wrap the title in a paragraph; flatten so the
  // summary stays inline.
  for (const child of title.getChildren()) {
    if ($isParagraphNode(child)) {
      const nested = child.getChildren();
      child.remove();
      title.append(...nested);
    }
  }
}

function $exportBodyMarkdown(
  content: CollapsibleContentNode,
  transformers: Transformer[]
): string {
  return $convertToMarkdownString(transformers, content).trim();
}

function $fillContentFromMarkdown(
  content: CollapsibleContentNode,
  markdown: string,
  transformers: Transformer[]
): void {
  const trimmed = markdown.trim();
  if (!trimmed) {
    if (content.getChildrenSize() === 0) {
      content.append($createParagraphNode());
    }
    return;
  }
  $convertFromMarkdownString(trimmed, transformers, content);
  if (content.getChildrenSize() === 0) {
    content.append($createParagraphNode());
  }
}

export const I_COLLAPSIBLE_NODE: ElementTransformer = {
  dependencies: [
    CollapsibleContainerNode,
    CollapsibleTitleNode,
    CollapsibleContentNode,
    UnknownMentionNode,
  ],
  type: 'element',
  regExp: /<m-collapsible>(.*?)<\/m-collapsible>/,
  export: (node: LexicalNode) => {
    if (!$isCollapsibleContainerNode(node)) return null;
    const title = node.getTitle();
    const content = node.getContent();
    if (!title || !content) return null;

    const data = escapeAngleBrackets(
      JSON.stringify({
        heading: title.getHeading(),
        title: $exportTitleMarkdown(title),
        body: $exportBodyMarkdown(
          content,
          collapsibleInternalBodyTransformers()
        ),
      })
    );
    return `<m-collapsible>${data}</m-collapsible>`;
  },
  replace: (parentNode: ElementNode, _children, match) => {
    try {
      const parsed = JSON.parse(match[1] ?? '') as {
        heading?: unknown;
        title?: unknown;
        body?: unknown;
      };
      const heading = isCollapsibleHeading(parsed.heading)
        ? parsed.heading
        : 'p';
      const titleMarkdown =
        typeof parsed.title === 'string' ? parsed.title : '';
      const bodyMarkdown = typeof parsed.body === 'string' ? parsed.body : '';

      const container = $createCollapsibleContainerNode(true);
      const title = $createCollapsibleTitleNode(heading);
      const content = $createCollapsibleContentNode();
      $fillTitleFromMarkdown(title, titleMarkdown);
      $fillContentFromMarkdown(
        content,
        bodyMarkdown,
        collapsibleInternalBodyTransformers()
      );
      container.append(title, content);
      parentNode.replace(container);
    } catch (error) {
      console.error('Error parsing m-collapsible:', error);
      replaceElementWithUnknownMention(parentNode, 'Unknown Collapsible');
    }
  },
};

export const E_COLLAPSIBLE_NODE: ElementTransformer = {
  dependencies: [
    CollapsibleContainerNode,
    CollapsibleTitleNode,
    CollapsibleContentNode,
  ],
  type: 'element',
  // Internal XML is the source of truth; GFM <details> is export-only.
  regExp: /$^/,
  export: (node: LexicalNode) => {
    if (!$isCollapsibleContainerNode(node)) return null;
    const title = node.getTitle();
    const content = node.getContent();
    if (!title || !content) return null;

    const titleMarkdown = $exportTitleMarkdown(title);
    const summary =
      `${headingPrefix(title.getHeading())}${titleMarkdown}`.trim();
    const body = $exportBodyMarkdown(
      content,
      collapsibleExternalBodyTransformers()
    );

    const summaryBlock = summary.length > 0 ? `\n\n${summary}\n\n` : '\n';
    const bodyBlock = body.length > 0 ? `\n\n${body}\n\n` : '\n';
    return `<details>\n<summary>${summaryBlock}</summary>${bodyBlock}</details>`;
  },
  replace: () => false,
};
