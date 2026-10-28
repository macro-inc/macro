import {
  TEXT_FORMAT_TRANSFORMERS,
  type TextMatchTransformer,
} from '@lexical/markdown';
import {
  $isTextNode,
  type LexicalNode,
  type TextFormatType,
  type TextNode,
} from 'lexical';

type HtmlTextFormat = {
  format: TextFormatType;
  closeTag: string;
  openTag: string;
};

const HTML_TEXT_FORMATS: HtmlTextFormat[] = [
  { closeTag: '</u>', format: 'underline', openTag: '<u>' },
  { closeTag: '</sup>', format: 'superscript', openTag: '<sup>' },
  { closeTag: '</sub>', format: 'subscript', openTag: '<sub>' },
];

const MARKDOWN_TEXT_TAGS = [
  ...new Set(
    TEXT_FORMAT_TRANSFORMERS.filter(({ format }) => format.length === 1).map(
      ({ tag }) => tag
    )
  ),
].sort((left, right) => right.length - left.length);

function wrapInsideMarkdownTags(content: string, node: TextNode): string {
  let inner = content;
  let prefix = '';
  let suffix = '';

  while (inner !== '') {
    const whitespace = inner.match(/^\s+/)?.[0];
    const tag = MARKDOWN_TEXT_TAGS.find((candidate) =>
      inner.startsWith(candidate)
    );
    const boundary = whitespace ?? tag;
    if (!boundary) break;
    prefix += boundary;
    inner = inner.slice(boundary.length);
  }

  while (inner !== '') {
    const whitespace = inner.match(/\s+$/)?.[0];
    const tag = MARKDOWN_TEXT_TAGS.find((candidate) =>
      inner.endsWith(candidate)
    );
    const boundary = whitespace ?? tag;
    if (!boundary) break;
    suffix = boundary + suffix;
    inner = inner.slice(0, -boundary.length);
  }

  const formats = HTML_TEXT_FORMATS.filter(({ format }) =>
    node.hasFormat(format)
  );
  const openingTags = formats.map(({ openTag }) => openTag).join('');
  const closingTags = formats
    .toReversed()
    .map(({ closeTag }) => closeTag)
    .join('');

  return `${prefix}${openingTags}${inner}${closingTags}${suffix}`;
}

function createHtmlTextFormatImporter({
  format,
  openTag,
}: HtmlTextFormat): TextMatchTransformer {
  const tag = openTag.slice(1, -1);
  const regExp = new RegExp(`<${tag}>(.*?)</${tag}>`, 'i');

  return {
    dependencies: [],
    importRegExp: regExp,
    regExp,
    replace: (textNode: TextNode, match: RegExpMatchArray) => {
      textNode.setTextContent(match[1]);
      if (!textNode.hasFormat(format)) {
        textNode.toggleFormat(format);
      }
      return textNode;
    },
    type: 'text-match',
  };
}

/** Imports paired HTML tags into their corresponding Lexical text formats. */
export const HTML_TEXT_FORMAT_IMPORTERS = HTML_TEXT_FORMATS.map(
  createHtmlTextFormatImporter
);

/**
 * Serializes Lexical formats whose Markdown representation uses paired HTML
 * tags. Lexical's text-format transformers only support symmetric delimiters,
 * so these formats must be handled as a text-match export instead.
 */
export const HTML_TEXT_FORMAT_EXPORTER: TextMatchTransformer = {
  dependencies: [],
  export: (node: LexicalNode, _exportChildren, exportFormat): string | null => {
    if (!$isTextNode(node)) return null;
    if (!HTML_TEXT_FORMATS.some(({ format }) => node.hasFormat(format))) {
      return null;
    }

    return wrapInsideMarkdownTags(
      exportFormat(node, node.getTextContent()),
      node
    );
  },
  regExp: /$a/,
  type: 'text-match',
};

export const HTML_TEXT_FORMAT_TRANSFORMERS = [
  HTML_TEXT_FORMAT_EXPORTER,
  ...HTML_TEXT_FORMAT_IMPORTERS,
];
