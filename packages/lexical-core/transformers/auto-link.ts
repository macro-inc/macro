import { $createLinkNode, $isLinkNode, LinkNode } from '@lexical/link';
import type { TextMatchTransformer } from '@lexical/markdown';
import { $findMatchingParent } from '@lexical/utils';
import { $createTextNode } from 'lexical';
import {
  $createUnlinkedTextNode,
  UnlinkedTextNode,
} from '../nodes/UnlinkedTextNode';
import { findAutoLinkMatches } from '../utils/auto-link';
import type { ConversionOnlyTransformer } from './transformers';

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

// Preserve source offsets while decoding Markdown escapes so the importer can
// replace exactly the escaped URL, not a neighboring literal or markup tag.
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
      const groups: [string, string] = [raw, link.text];
      return Object.assign(groups, { index: start, input: source });
    }
    return null;
  }
}

export const ESCAPED_AUTO_LINK: ConversionOnlyTransformer<TextMatchTransformer> =
  {
    dependencies: [UnlinkedTextNode],
    importRegExp: new EscapedAutoLinkRegExp(''),
    regExp: new EscapedAutoLinkRegExp(''),
    replace: (textNode, match) => {
      if ($findMatchingParent(textNode, $isLinkNode)) return;
      textNode.replace(
        $createUnlinkedTextNode(match[1]).setFormat(textNode.getFormat())
      );
    },
    type: 'text-match',
    conversionOnly: true,
  };

export const AUTO_LINK: ConversionOnlyTransformer<TextMatchTransformer> = {
  dependencies: [LinkNode],
  importRegExp: new AutoLinkRegExp(''),
  regExp: new AutoLinkRegExp(''),
  replace: (textNode, match) => {
    if ($findMatchingParent(textNode, $isLinkNode)) return;
    const link = $createLinkNode(match[1]);
    link.append($createTextNode(match[2]).setFormat(textNode.getFormat()));
    textNode.replace(link);
    // Do not return the label for further Markdown parsing: URL punctuation
    // is literal, even when it resembles emphasis or strikethrough.
  },
  type: 'text-match',
  conversionOnly: true,
};
