import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type MultilineElementTransformer,
  type Transformer,
} from '@lexical/markdown';
import { $getEditor, $isParagraphNode, type ElementNode } from 'lexical';
import {
  $createDetailsNode,
  $createDetailsSummaryNode,
  $isDetailsNode,
  $isDetailsSummaryNode,
  DetailsNode,
  DetailsSummaryNode,
} from '../nodes/DetailsNode';

const REG_EXP_DETAILS_START = /^\s*<details(\s[^>]*)?>(.*)$/i;
const REG_EXP_DETAILS_END = /^(.*?)<\/details>\s*$/i;
const REG_EXP_DETAILS_TAG = /<(\/?)details(?:\s[^>]*)?>/gi;
const REG_EXP_SUMMARY = /^\s*<summary(?:\s[^>]*)?>([\s\S]*?)<\/summary>/i;
const REG_EXP_OPEN_ATTRIBUTE = /(?:^|\s)open(?:\s|=|$)/i;
const REG_EXP_FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** A line's text up to the `</details>` that closes the outermost section. */
function consumeDetailsLine(
  line: string,
  startingDepth: number
): { closed: boolean; depth: number; text: string } {
  let depth = startingDepth;
  for (const match of line.matchAll(REG_EXP_DETAILS_TAG)) {
    depth += match[1] === '/' ? -1 : 1;
    if (depth === 0) {
      return { closed: true, depth, text: line.slice(0, match.index) };
    }
  }
  return { closed: false, depth, text: line };
}

/** The transformers usable in this editor: the ones whose nodes it registered. */
function $editorTransformers(transformers: Transformer[]): Transformer[] {
  const editor = $getEditor();
  return transformers.filter(
    (transformer) =>
      // Text formats declare no dependencies at all.
      !('dependencies' in transformer) ||
      transformer.dependencies.every((dependency) => editor.hasNode(dependency))
  );
}

/** Moves a lone paragraph's children up so the summary reads as one line. */
function $unwrapSingleParagraph(node: ElementNode) {
  const children = node.getChildren();
  if (children.length !== 1) return;
  const [paragraph] = children;
  if (!$isParagraphNode(paragraph)) return;
  node.append(...paragraph.getChildren());
  paragraph.remove();
}

function $createDetails(
  attributes: string,
  content: string,
  transformers: Transformer[]
): DetailsNode {
  const details = $createDetailsNode(REG_EXP_OPEN_ATTRIBUTE.test(attributes));
  const summary = $createDetailsSummaryNode();
  details.append(summary);

  const summaryMatch = content.match(REG_EXP_SUMMARY);
  const summaryMarkdown = summaryMatch?.[1]?.trim() ?? '';
  const body = summaryMatch ? content.slice(summaryMatch[0].length) : content;

  // GitHub labels a section without a summary "Details".
  $convertFromMarkdownString(
    summaryMarkdown || 'Details',
    transformers,
    summary
  );
  $unwrapSingleParagraph(summary);

  const bodyMarkdown = body.trim();
  if (bodyMarkdown) {
    const bodyHolder = $createDetailsSummaryNode();
    $convertFromMarkdownString(bodyMarkdown, transformers, bodyHolder);
    details.append(...bodyHolder.getChildren());
  }
  return details;
}

/**
 * GitHub's collapsible `<details><summary>…</summary>…</details>` sections,
 * nested to any depth, as a {@link DetailsNode}. The summary and body are
 * Markdown, imported with the same transformers as the surrounding text.
 *
 * Its dependencies are the details nodes, so editors that don't register them
 * (every editor but the read-only renderer) filter it out.
 */
export function createDetailsTransformer(
  transformers: () => Transformer[]
): MultilineElementTransformer {
  return {
    dependencies: [DetailsNode, DetailsSummaryNode],
    type: 'multiline-element',
    regExpStart: REG_EXP_DETAILS_START,
    regExpEnd: REG_EXP_DETAILS_END,
    handleImportAfterStartMatch: ({
      lines,
      rootNode,
      startLineIndex,
      startMatch,
    }) => {
      // Callers that don't filter transformers by node (services, SDK
      // helpers) leave `<details>` as text, as before.
      if (!$getEditor().hasNode(DetailsNode)) return null;
      let depth = 1;
      let fence: string | null = null;
      const content: string[] = [];
      for (let index = startLineIndex; index < lines.length; index++) {
        const line =
          index === startLineIndex ? (startMatch[2] ?? '') : lines[index];
        // Tags quoted in fenced code don't open or close a section.
        const fenceMarker = line.match(REG_EXP_FENCE)?.[1];
        if (fence) {
          if (fenceMarker?.startsWith(fence)) fence = null;
          content.push(line);
          continue;
        }
        if (fenceMarker) {
          fence = fenceMarker;
          content.push(line);
          continue;
        }
        const consumed = consumeDetailsLine(line, depth);
        depth = consumed.depth;
        content.push(consumed.text);
        if (consumed.closed) {
          rootNode.append(
            $createDetails(
              startMatch[1] ?? '',
              content.join('\n'),
              $editorTransformers(transformers())
            )
          );
          return [true, index];
        }
      }
      // Unclosed: leave the lines to the other transformers.
      return null;
    },
    replace: () => false,
    export: (node, exportChildren) => {
      if (!$isDetailsNode(node)) return null;
      const summaryNode = node.getFirstChild();
      const summary = $isDetailsSummaryNode(summaryNode)
        ? exportChildren(summaryNode)
        : '';
      // The body export starts with the summary, a block without its own
      // transformer that exports as its text.
      let body = $convertToMarkdownString(
        $editorTransformers(transformers()),
        node
      );
      if (summary && body.startsWith(summary)) {
        body = body.slice(summary.length);
      }
      const open = node.isOpen() ? ' open' : '';
      return `<details${open}>\n<summary>${summary}</summary>\n\n${body.trim()}\n\n</details>`;
    },
  };
}
