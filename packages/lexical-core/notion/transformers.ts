/**
 * Transformers that read Notion's enhanced markdown (the `GET
 * /v1/pages/{id}/markdown` and `notion-fetch` dialect) into Macro's Lexical
 * nodes. Run them ahead of {@link ALL_TRANSFORMERS}, which handle the
 * standard markdown in between.
 *
 * Every Notion construct becomes a real node where Macro has one (document,
 * user and date mentions, tables, check lists, equations, images) and
 * readable text where it has none (callouts become quotes, toggles and
 * columns flatten into their content). No Notion tag survives as raw text.
 *
 * Spec: https://developers.notion.com/guides/data-apis/enhanced-markdown
 */
import { $createLinkNode } from '@lexical/link';
import {
  $convertFromMarkdownString,
  type ElementTransformer,
  type MultilineElementTransformer,
  type TextMatchTransformer,
  type Transformer,
} from '@lexical/markdown';
import { $createQuoteNode, type QuoteNode } from '@lexical/rich-text';
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from '@lexical/table';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $isParagraphNode,
  type ElementNode,
  type LexicalNode,
  LineBreakNode,
  type TextNode,
} from 'lexical';
import { match } from 'ts-pattern';
import {
  $createDateMentionNode,
  DateMentionNode,
} from '../nodes/DateMentionNode';
import {
  $createDocumentMentionNode,
  DocumentMentionNode,
} from '../nodes/DocumentMentionNode';
import { $createImageNode, ImageNode } from '../nodes/ImageNode';
import {
  $createUserMentionNode,
  UserMentionNode,
} from '../nodes/UserMentionNode';
import { ALL_TRANSFORMERS } from '../transformers';
import { findNotionPage, findNotionUser, type NotionLinks } from './links';

type Attributes = Record<string, string>;

function attributes(raw: string | undefined): Attributes {
  const parsed: Attributes = {};
  for (const [, name, value] of (raw ?? '').matchAll(/([\w-]+)="([^"]*)"/g)) {
    parsed[name] = value
      .replaceAll('&quot;', '"')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&');
  }
  return parsed;
}

function isWebUrl(value: string | undefined): value is string {
  return value?.startsWith('https://') || value?.startsWith('http://') || false;
}

function withoutTags(value: string): string {
  return value.replace(/<[^>]+>/g, '').trim();
}

/** Replace `node` with a link to `url` labelled `label`, or with the label alone when `url` isn't a web link. */
function $replaceWithLink(
  node: TextNode,
  url: string | undefined,
  label: string
): TextNode {
  const text = $createTextNode(label);
  text.setFormat(node.getFormat());
  if (!isWebUrl(url)) {
    node.replace(text);
    return text;
  }
  const link = $createLinkNode(url);
  link.append(text);
  node.replace(link);
  return text;
}

/** A page or database reference: a mention of the Macro document it became, else a link back to Notion. */
function $replaceWithPageReference(
  node: TextNode,
  links: NotionLinks,
  attrs: Attributes,
  label: string
): TextNode | undefined {
  const reference = attrs.url ?? '';
  const page = findNotionPage(links, reference);
  if (page) {
    node.replace(
      $createDocumentMentionNode({
        documentId: page.documentId,
        documentName: page.name,
        blockName: 'md',
      })
    );
    return undefined;
  }
  const title = withoutTags(label) || attrs.title?.trim() || 'Notion page';
  return $replaceWithLink(node, reference, title);
}

/** Noon UTC for a bare date, so it lands on the same day in every time zone. */
function notionInstant(
  date: string | undefined,
  time: string | undefined,
  timeZone: string | undefined
): Date | undefined {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return new Date(`${date}T12:00:00.000Z`);
  }
  const wallClock = new Date(`${date}T${time}:00.000Z`);
  if (!timeZone) return wallClock;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(wallClock);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((candidate) => candidate.type === type)?.value);
    const zoned = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute')
    );
    return new Date(wallClock.getTime() - (zoned - wallClock.getTime()));
  } catch {
    return wallClock;
  }
}

function dateLabel(date: string, time: string | undefined): string {
  const label = new Date(`${date}T12:00:00.000Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return time ? `${label} ${time}` : label;
}

function $dateMention(
  date: string | undefined,
  time: string | undefined,
  timeZone: string | undefined
): LexicalNode | undefined {
  const instant = notionInstant(date, time, timeZone);
  if (!instant || !date) return undefined;
  return $createDateMentionNode({
    date: instant.toISOString(),
    displayFormat: dateLabel(date, time),
  });
}

function $replaceWithDateMention(node: TextNode, attrs: Attributes): void {
  const start = $dateMention(attrs.start, attrs.startTime, attrs.timeZone);
  if (!start) {
    node.replace($createTextNode(attrs.start ?? ''));
    return;
  }
  node.replace(start);
  if (!attrs.end || attrs.end === attrs.start) return;
  const end = $dateMention(attrs.end, attrs.endTime, attrs.timeZone);
  if (!end) return;
  start.insertAfter(end);
  start.insertAfter($createTextNode(' – '));
}

function fileName(url: string | undefined): string | undefined {
  if (!isWebUrl(url)) return undefined;
  try {
    const last = new URL(url).pathname.split('/').pop();
    return last ? decodeURIComponent(last) : undefined;
  } catch {
    return undefined;
  }
}

function textMatch(
  regExp: RegExp,
  dependencies: TextMatchTransformer['dependencies'],
  replace: (node: TextNode, match: RegExpMatchArray) => TextNode | void
): TextMatchTransformer {
  return {
    dependencies,
    type: 'text-match',
    regExp,
    importRegExp: regExp,
    replace,
  };
}

function inlineTransformers(links: NotionLinks): TextMatchTransformer[] {
  return [
    textMatch(
      /<(mention-page|page|database|mention-database|mention-data-source)\b([^>]*)>(.*?)<\/\1>/,
      [DocumentMentionNode],
      (node, [, , attrs, label]) =>
        $replaceWithPageReference(node, links, attributes(attrs), label)
    ),
    textMatch(
      /<(?:mention-page|page|database|mention-database|mention-data-source)\b([^>]*?)\/>/,
      [DocumentMentionNode],
      (node, [, attrs]) =>
        $replaceWithPageReference(node, links, attributes(attrs), '')
    ),
    textMatch(
      /<mention-user\b([^>]*?)(?:\/>|>(.*?)<\/mention-user>)/,
      [UserMentionNode],
      (node, [, attrs, label]) => {
        const name = withoutTags(label ?? '');
        const user = findNotionUser(links, attributes(attrs).url ?? '');
        if (user) {
          node.replace(
            $createUserMentionNode({
              userId: user.userId,
              email: user.email,
              displayName: name || undefined,
            })
          );
          return;
        }
        if (!name) {
          node.remove();
          return;
        }
        node.setTextContent(`@${name}`);
      }
    ),
    textMatch(
      /<mention-agent\b[^>]*>(.*?)<\/mention-agent>/,
      [],
      (node, [, label]) => {
        const name = withoutTags(label);
        if (!name) {
          node.remove();
          return;
        }
        node.setTextContent(`@${name}`);
      }
    ),
    textMatch(
      /<mention-date\b([^>]*?)(?:\/>|>(?:.*?)<\/mention-date>)/,
      [DateMentionNode],
      (node, [, attrs]) => $replaceWithDateMention(node, attributes(attrs))
    ),
    textMatch(
      /<(file|pdf|audio|video)\b([^>]*)>(.*?)<\/\1>/,
      [],
      (node, [, , attrs, caption]) => {
        const parsed = attributes(attrs);
        const url = parsed.src ?? parsed.url;
        const label = withoutTags(caption) || fileName(url) || 'Notion file';
        return $replaceWithLink(node, url, label);
      }
    ),
    textMatch(
      /<(?:file|pdf|audio|video)\b([^>]*?)\/?>/,
      [],
      (node, [, attrs]) => {
        const parsed = attributes(attrs);
        const url = parsed.src ?? parsed.url;
        return $replaceWithLink(node, url, fileName(url) ?? 'Notion file');
      }
    ),
    textMatch(
      /<unknown\b([^>]*?)\/?>/,
      [DocumentMentionNode],
      (node, [, attrs]) => {
        const parsed = attributes(attrs);
        if (findNotionPage(links, parsed.url ?? '')) {
          return $replaceWithPageReference(
            node,
            links,
            parsed,
            parsed.alt ?? ''
          );
        }
        if (!isWebUrl(parsed.url)) {
          node.remove();
          return;
        }
        return $replaceWithLink(
          node,
          parsed.url,
          parsed.alt?.trim() || 'Unsupported Notion content'
        );
      }
    ),
    textMatch(/<span\b([^>]*)>(.*?)<\/span>/, [], (node, [, attrs, inner]) => {
      node.setTextContent(inner);
      if (
        attributes(attrs).underline === 'true' &&
        !node.hasFormat('underline')
      ) {
        node.toggleFormat('underline');
      }
      return node;
    }),
    // Block colors and toggle-heading markers: `# Title {toggle="true"}`.
    textMatch(
      /[ \t]*\{(?:(?:toggle|color)\s*=\s*"[^"]*"[ \t]*)+\}[ \t]*$/,
      [],
      (node) => {
        node.remove();
      }
    ),
    // Anything Notion-specific left over keeps its text but loses its tag.
    textMatch(
      /<\/?(?:mention-[\w-]+|span|page|ancestor-\d+-page|database|data-source|unknown|file|pdf|audio|video|image|empty-block|table_of_contents|custom-block|synced_block(?:_reference)?|columns?|callout|details|summary|ancestor-path|colgroup|col|tr|td|th|table)\b[^>]*>/,
      [],
      (node) => {
        node.remove();
      }
    ),
  ];
}

const EMPTY_BLOCK: ElementTransformer = {
  dependencies: [],
  type: 'element',
  regExp: /^\s*<empty-block\s*\/?>\s*$/,
  export: () => null,
  // The paragraph stays, empty: Notion's way of spacing blocks apart.
  replace: () => {},
};

const DROPPED_BLOCK: ElementTransformer = {
  dependencies: [],
  type: 'element',
  regExp: /^\s*<(?:table_of_contents|custom-block)\b[^>]*\/?>\s*$/,
  export: () => null,
  replace: (parent) => {
    parent.remove();
  },
};

const IMAGE_BLOCK: ElementTransformer = {
  dependencies: [ImageNode],
  type: 'element',
  regExp: /^\s*<image\b([^>]*?)(?:\/>|>(.*?)<\/image>)\s*$/,
  export: () => null,
  replace: (parent, _children, [, attrs, caption]) => {
    const parsed = attributes(attrs);
    const url = parsed.src ?? parsed.source ?? parsed.url;
    if (!isWebUrl(url)) {
      parent.clear();
      parent.append($createTextNode(withoutTags(caption ?? '')));
      return;
    }
    parent.replace(
      $createImageNode({
        srcType: 'url',
        url,
        alt: withoutTags(caption ?? ''),
        id: '',
        width: 0,
        height: 0,
      })
    );
  },
};

const CONTAINER_TAGS = [
  'details',
  'callout',
  'columns',
  'column',
  'synced_block',
  'synced_block_reference',
  'ancestor-path',
  'table',
] as const;
type ContainerTag = (typeof CONTAINER_TAGS)[number];

const CONTAINER_OPEN = new RegExp(
  `^\\s*<(${CONTAINER_TAGS.join('|')})\\b([^>]*?)>`
);

function isContainerTag(tag: string): tag is ContainerTag {
  return CONTAINER_TAGS.some((candidate) => candidate === tag);
}

const FENCE = /^\s*(`{3,}|~{3,})/;

/**
 * The lines inside a container opened at `start`, up to its matching close
 * tag (nested containers of the same tag included), and what follows the
 * close tag on its line.
 */
function containerContent(
  lines: string[],
  start: number,
  tag: ContainerTag,
  rest: string
): { inner: string[]; end: number; after: string } {
  const tags = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'g');
  const inner: string[] = [];
  let depth = 1;
  let fence: string | undefined;
  let line = rest;
  for (let index = start; index < lines.length; ) {
    const marker = line.match(FENCE)?.[1];
    if (fence) {
      if (marker?.startsWith(fence)) fence = undefined;
    } else if (marker) {
      fence = marker;
    } else {
      for (const found of line.matchAll(tags)) {
        if (found[2]) continue;
        depth += found[1] ? -1 : 1;
        if (depth === 0) {
          const at = found.index ?? 0;
          inner.push(line.slice(0, at));
          return { inner, end: index, after: line.slice(at + found[0].length) };
        }
      }
    }
    inner.push(line);
    index += 1;
    line = lines[index] ?? '';
  }
  // Never closed: everything to the end of the page is its content.
  return { inner, end: lines.length - 1, after: '' };
}

function dedent(lines: string[]): string {
  return lines
    .map((line) => line.replace(/^(?:\t| {4})/, ''))
    .filter((line) => line.trim() !== '')
    .join('\n');
}

/** Callout content as quotes: runs of paragraphs share one quote, the icon leading. */
function $calloutNodes(
  nodes: LexicalNode[],
  icon: string | undefined
): LexicalNode[] {
  const output: LexicalNode[] = [];
  let quote: QuoteNode | undefined;
  let leading = icon && !isWebUrl(icon) ? `${icon} ` : undefined;
  for (const node of nodes) {
    if (!$isParagraphNode(node)) {
      quote = undefined;
      output.push(node);
      continue;
    }
    if (quote) {
      quote.append($createLineBreakNode());
    } else {
      quote = $createQuoteNode();
      output.push(quote);
    }
    if (leading) {
      quote.append($createTextNode(leading));
      leading = undefined;
    }
    quote.append(...node.getChildren());
  }
  return output;
}

function $tableNode(
  html: string,
  attrs: Attributes,
  $import: (markdown: string) => LexicalNode[]
): TableNode | undefined {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]
    .map(([, row]) =>
      [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(
        ([, cell]) => cell
      )
    )
    .filter((cells) => cells.length > 0);
  const columns = Math.max(0, ...rows.map((cells) => cells.length));
  if (columns === 0) return undefined;
  const headerRow = attrs['header-row'] === 'true';
  const headerColumn = attrs['header-column'] === 'true';
  const table = $createTableNode();
  rows.forEach((cells, rowIndex) => {
    const row = $createTableRowNode();
    for (let column = 0; column < columns; column += 1) {
      const header =
        (headerRow && rowIndex === 0 ? TableCellHeaderStates.ROW : 0) |
        (headerColumn && column === 0 ? TableCellHeaderStates.COLUMN : 0);
      const cell = $createTableCellNode(header);
      const content = (cells[column] ?? '')
        .split(/<br\s*\/?>|\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .join('\n');
      const nodes = content ? $import(content) : [];
      cell.append(...(nodes.length > 0 ? nodes : [$createParagraphNode()]));
      row.append(cell);
    }
    table.append(row);
  });
  return table;
}

function containerTransformer(
  $import: (markdown: string) => LexicalNode[]
): MultilineElementTransformer {
  return {
    dependencies: [TableNode, TableRowNode, TableCellNode, LineBreakNode],
    type: 'multiline-element',
    regExpStart: CONTAINER_OPEN,
    export: () => null,
    handleImportAfterStartMatch: ({
      lines,
      rootNode,
      startLineIndex,
      startMatch,
    }) => {
      const [opening, tag, rawAttrs] = startMatch;
      if (!isContainerTag(tag) || rawAttrs.endsWith('/')) return null;
      const attrs = attributes(rawAttrs);
      const rest = lines[startLineIndex].slice(
        (startMatch.index ?? 0) + opening.length
      );
      const { inner, end, after } = containerContent(
        lines,
        startLineIndex,
        tag,
        rest
      );
      const content = dedent(inner);
      const nodes = match(tag)
        .with('details', () => {
          const summary = content.match(/^\s*<summary>([\s\S]*?)<\/summary>/);
          const children = summary ? content.slice(summary[0].length) : content;
          return [
            ...(summary ? $import(summary[1].replaceAll('\n', ' ')) : []),
            ...$import(children.trim()),
          ];
        })
        .with('callout', () => $calloutNodes($import(content), attrs.icon))
        .with('table', () => {
          const table = $tableNode(content, attrs, $import);
          return table ? [table] : [];
        })
        .with('ancestor-path', () => [])
        .with(
          'columns',
          'column',
          'synced_block',
          'synced_block_reference',
          () => $import(content)
        )
        .exhaustive();
      rootNode.append(...nodes);
      if (after.trim()) rootNode.append(...$import(after.trim()));
      return [true, end];
    },
    replace: () => false,
  };
}

/**
 * Notion markdown with blank lines dropped (Notion separates blocks by line,
 * and spells an empty block `<empty-block/>`), indentation kept only where
 * it means nesting (list items, code), and to-dos the MCP server escapes
 * (`\[x\] Done`) restored.
 */
export function notionLines(markdown: string): string {
  const output: string[] = [];
  let fence: string | undefined;
  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const marker = line.match(FENCE)?.[1];
    if (fence) {
      output.push(line);
      if (marker?.startsWith(fence)) fence = undefined;
      continue;
    }
    if (marker) {
      fence = marker;
      output.push(line);
      continue;
    }
    if (line.trim() === '') continue;
    const todo = line.match(/^(\s*)(?:-\s+)?\\\[([ xX])\\\](.*)$/);
    if (todo) {
      output.push(`${todo[1]}- [${todo[2].toLowerCase()}]${todo[3]}`);
      continue;
    }
    output.push(/^\s*(?:[-*+]|\d+[.)])\s/.test(line) ? line : line.trimStart());
  }
  return output.join('\n');
}

/** The transformers for Notion markdown whose references resolve through `links`. */
export function notionTransformers(links: NotionLinks): Transformer[] {
  const transformers: Transformer[] = [];
  const $import = (markdown: string): LexicalNode[] => {
    // A detached scratch container: the import clears whatever node it
    // writes into, so it can't write into the root being built.
    const scratch: ElementNode = $createParagraphNode();
    $convertFromMarkdownString(markdown, transformers, scratch, true);
    return scratch.getChildren();
  };
  transformers.push(
    containerTransformer($import),
    EMPTY_BLOCK,
    DROPPED_BLOCK,
    IMAGE_BLOCK,
    ...inlineTransformers(links),
    ...ALL_TRANSFORMERS
  );
  return transformers;
}
