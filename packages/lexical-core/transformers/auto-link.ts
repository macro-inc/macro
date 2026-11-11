import { $createLinkNode, $isLinkNode, LinkNode } from '@lexical/link';
import type { TextMatchTransformer } from '@lexical/markdown';
import { $findMatchingParent } from '@lexical/utils';
import { $createTextNode, $isTextNode, type TextNode } from 'lexical';
import {
  $createUnlinkedTextNode,
  $isUnlinkedTextNode,
  UnlinkedTextNode,
} from '../nodes/UnlinkedTextNode';
import { findAutoLinkMatches } from '../utils/auto-link';
import type { ConversionOnlyTransformer } from './transformers';

// Lexical's Markdown export escapes these characters in plain text, so a URL
// saved before the editor linked it carries their escapes. Other escapes, such
// as `\.` or `\:`, mark a URL written to stay literal.
const FORMATTING_CHARACTER = /[*_`~]/;

// Stands in for each URL while Lexical escapes and formats the rest of a text
// node; a private-use character that editor text does not contain.
const URL_PLACEHOLDER = '';

// Lexical's import API takes a RegExp. Adapt the shared URL matcher to that
// interface so URL boundaries are determined by linkify-it in both editors and
// imports, before Markdown formatting can consume characters inside a URL.
class AutoLinkRegExp extends RegExp {
  override exec(text: string): RegExpExecArray | null {
    const link = findAutoLinkMatches(text, 'common-tlds').find(
      (candidate) =>
        // Escaped Markdown is literal, including a URL whose escaped dot made
        // the recognizer stop at a partial hostname (https://example\\.com).
        !candidate.raw.includes('\\') &&
        text[candidate.lastIndex] !== '\\' &&
        text[candidate.index - 1] !== '\\'
    );
    if (!link) return null;
    const bracketed =
      text[link.index - 1] === '<' && text[link.lastIndex] === '>';
    const start = bracketed ? link.index - 1 : link.index;
    const end = bracketed ? link.lastIndex + 1 : link.lastIndex;
    const groups: [string, string, string] = [
      text.slice(start, end),
      link.url,
      link.text,
    ];
    return Object.assign(groups, {
      index: start,
      input: text,
    });
  }
}

function hasOnlyFormattingEscapes(raw: string): boolean {
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '\\') continue;
    if (!FORMATTING_CHARACTER.test(raw[i + 1] ?? '')) return false;
    i++;
  }
  return true;
}

// Preserve source offsets while decoding Markdown escapes so the importer can
// replace exactly the escaped URL, not a neighboring literal or markup tag.
// The third group is the link destination, or empty to keep the URL literal.
class EscapedAutoLinkRegExp extends RegExp {
  override exec(source: string): RegExpExecArray | null {
    if (!source.includes('\\')) return null;
    const offsets: number[] = [];
    let decoded = '';
    for (let i = 0; i < source.length; i++) {
      offsets.push(i);
      if (source[i] === '\\' && /[!-/:-@[-`{-~]/.test(source[i + 1] ?? '')) i++;
      decoded += source[i];
    }
    offsets.push(source.length);
    for (const link of findAutoLinkMatches(decoded, 'common-tlds')) {
      const start = offsets[link.index];
      const raw = source.slice(start, offsets[link.lastIndex]);
      if (raw === link.text) continue;
      const url = hasOnlyFormattingEscapes(raw) ? link.url : '';
      const groups: [string, string, string] = [raw, link.text, url];
      return Object.assign(groups, { index: start, input: source });
    }
    return null;
  }
}

function $replaceWithLink(textNode: TextNode, url: string, label: string) {
  const link = $createLinkNode(url);
  link.append($createTextNode(label).setFormat(textNode.getFormat()));
  textNode.replace(link);
  // Do not return the label for further Markdown parsing: URL punctuation
  // is literal, even when it resembles emphasis or strikethrough.
}

export const ESCAPED_AUTO_LINK: ConversionOnlyTransformer<TextMatchTransformer> =
  {
    dependencies: [LinkNode, UnlinkedTextNode],
    importRegExp: new EscapedAutoLinkRegExp(''),
    regExp: new EscapedAutoLinkRegExp(''),
    replace: (textNode, match) => {
      if ($findMatchingParent(textNode, $isLinkNode)) return;
      const url = match[2];
      if (url) {
        $replaceWithLink(textNode, url, match[1]);
        return;
      }
      textNode.replace(
        $createUnlinkedTextNode(match[1]).setFormat(textNode.getFormat())
      );
    },
    type: 'text-match',
    conversionOnly: true,
  };

export const AUTO_LINK: ConversionOnlyTransformer<TextMatchTransformer> = {
  dependencies: [LinkNode],
  // An editor links a URL only once the caret leaves it, so a message sent
  // right after its URL holds the URL as plain text, whose `_`, `*`, `~` and
  // backticks Markdown export would escape. Write those URLs as typed, so
  // import links them like any other bare URL.
  export: (node, _exportChildren, exportFormat) => {
    if (!$isTextNode(node) || $isUnlinkedTextNode(node)) return null;
    if (node.hasFormat('code')) return null;

    const text = node.getTextContent();
    if (text.includes(URL_PLACEHOLDER)) return null;

    const links = findAutoLinkMatches(text, 'common-tlds').filter(
      (link) => FORMATTING_CHARACTER.test(link.raw) && !link.raw.includes('\\')
    );
    if (links.length === 0) return null;

    let masked = '';
    let end = 0;
    for (const link of links) {
      masked += text.slice(end, link.index) + URL_PLACEHOLDER;
      end = link.lastIndex;
    }
    masked += text.slice(end);

    let next = 0;
    return exportFormat(node, masked).replaceAll(
      URL_PLACEHOLDER,
      () => links[next++].raw
    );
  },
  importRegExp: new AutoLinkRegExp(''),
  regExp: new AutoLinkRegExp(''),
  replace: (textNode, match) => {
    if ($findMatchingParent(textNode, $isLinkNode)) return;
    $replaceWithLink(textNode, match[1], match[2]);
  },
  type: 'text-match',
  conversionOnly: true,
};
