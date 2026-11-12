import { For } from 'solid-js';

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] };

type ParsedContent = {
  eyebrow?: string;
  blocks: Block[];
};

// Bullet (`- ` / `* `) and numbered (`1. `) list markers. Only recognised when
// the caller opts in via `lists`, because the older legal pages write numbered
// clauses as ordinary paragraphs and must keep rendering that way.
const BULLET_RE = /^[-*]\s+(.*)$/;
const ORDERED_RE = /^\d+[.)]\s+(.*)$/;

function parseContent(content: string, lists: boolean): ParsedContent {
  const lines = content.split('\n').map((line) => line.trimEnd());
  const blocks: Block[] = [];
  const paragraphBuffer: string[] = [];
  let listBuffer: { ordered: boolean; items: string[] } | null = null;
  let eyebrow: string | undefined;

  const flushList = () => {
    if (!listBuffer) return;
    blocks.push({
      type: 'list',
      ordered: listBuffer.ordered,
      items: listBuffer.items,
    });
    listBuffer = null;
  };

  const flushParagraph = () => {
    flushList();
    if (paragraphBuffer.length === 0) return;
    blocks.push({
      type: 'paragraph',
      text: paragraphBuffer.join(' ').trim(),
    });
    paragraphBuffer.length = 0;
  };

  const pushListItem = (ordered: boolean, text: string) => {
    // A list interrupts any paragraph in progress, but paragraph text must be
    // emitted first so the two don't swap order.
    if (paragraphBuffer.length > 0) {
      blocks.push({
        type: 'paragraph',
        text: paragraphBuffer.join(' ').trim(),
      });
      paragraphBuffer.length = 0;
    }
    if (listBuffer && listBuffer.ordered !== ordered) flushList();
    if (!listBuffer) listBuffer = { ordered, items: [] };
    listBuffer.items.push(text);
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || /^_+$/.test(line)) {
      flushParagraph();
      continue;
    }

    if (lists) {
      const bullet = line.match(BULLET_RE);
      if (bullet) {
        pushListItem(false, bullet[1].trim());
        continue;
      }
      const ordered = line.match(ORDERED_RE);
      if (ordered) {
        pushListItem(true, ordered[1].trim());
        continue;
      }
      flushList();
    }

    if (!eyebrow && line === 'Macro') {
      eyebrow = line;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      continue;
    }

    if (
      /^[A-Z0-9 ."'()\-–:]+$/.test(line) &&
      line.endsWith(':') &&
      line.length <= 120
    ) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: 3,
        text: line,
      });
      continue;
    }

    paragraphBuffer.push(line);
  }

  flushParagraph();

  return { eyebrow, blocks };
}

function renderInline(text: string) {
  const normalizedText = text.replace(/\\`/g, '`');
  const parts: Array<
    | { type: 'text'; value: string }
    | { type: 'link'; label: string; href: string }
  > = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;

  for (const match of normalizedText.matchAll(linkRegex)) {
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        value: normalizedText.slice(lastIndex, match.index),
      });
    }

    parts.push({
      type: 'link',
      label: match[1],
      href: match[2].replaceAll('&#38;', '&'),
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < normalizedText.length) {
    parts.push({ type: 'text', value: normalizedText.slice(lastIndex) });
  }

  return (
    <For each={parts}>
      {(part) => {
        if (part.type === 'link') {
          return <a href={part.href}>{part.label}</a>;
        }

        return part.value;
      }}
    </For>
  );
}

export function UtilPlainText(props: {
  content: string;
  /** Render `- ` / `1. ` lines as real lists (off by default — see BULLET_RE). */
  lists?: boolean;
}) {
  const parsed = parseContent(props.content, props.lists ?? false);

  return (
    // `.legal-doc` (measure, and the padding that clears the fixed header)
    // comes from src/app/routes/RouteLegal.css, which every route rendering
    // this variant imports.
    <main class="legal-doc">
      {parsed.eyebrow ? (
        <div class="legal-eyebrow">{parsed.eyebrow}</div>
      ) : null}

      <For each={parsed.blocks}>
        {(block) => {
          if (block.type === 'heading') {
            const level = Math.min(block.level, 4);

            if (level === 1) return <h1>{block.text}</h1>;
            if (level === 2) return <h2>{block.text}</h2>;
            if (level === 3) return <h3>{block.text}</h3>;
            return <h4>{block.text}</h4>;
          }

          if (block.type === 'list') {
            const items = (
              <For each={block.items}>
                {(item) => <li>{renderInline(item)}</li>}
              </For>
            );
            return block.ordered ? (
              <ol class="legal-list">{items}</ol>
            ) : (
              <ul class="legal-list">{items}</ul>
            );
          }

          const isAccent =
            block.text.startsWith('Last updated:') ||
            block.text.startsWith('Effective:');
          return (
            <p class={isAccent ? 'legal-date' : undefined}>
              {renderInline(block.text)}
            </p>
          );
        }}
      </For>
    </main>
  );
}
