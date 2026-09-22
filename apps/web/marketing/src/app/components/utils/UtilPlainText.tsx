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

function renderInline(text: string, unstyled = false) {
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
          return unstyled ? (
            <a href={part.href}>{part.label}</a>
          ) : (
            <a
              href={part.href}
              style={{
                'text-underline-offset': '0.12em',
                'text-decoration': 'underline',
                color: 'var(--color-ink)',
              }}
            >
              {part.label}
            </a>
          );
        }

        return part.value;
      }}
    </For>
  );
}

const eyebrowStyle = {
  margin: '0 0 0.5rem',
  'font-size': '0.75rem',
  'font-weight': '700',
  'letter-spacing': '0.12em',
  'text-transform': 'uppercase',
  color: 'var(--color-ink-extra-muted)',
  'font-family': 'Rajdhani',
};

const headingStyles: Record<number, Record<string, string>> = {
  1: {
    margin: '0 0 1.5rem',
    'font-size': 'clamp(2.2rem, 7vw, 3.6rem)',
    'line-height': '1',
    'letter-spacing': '-0.04em',
    'font-family': 'Display',
    'font-weight': '500',
  },
  2: {
    margin: '2rem 0 0.9rem',
    'padding-top': '1.6rem',
    'border-top':
      '1px solid color-mix(in srgb, var(--color-edge), transparent 55%)',
    'font-size': '1.3rem',
    'line-height': '1.2',
    'font-family': 'Display',
    'font-weight': '500',
  },
  3: {
    margin: '1.35rem 0 0.7rem',
    'font-size': '1rem',
    'line-height': '1.3',
    'font-family': 'Display',
    'font-weight': '500',
    'text-transform': 'none',
  },
  4: {
    margin: '1rem 0 0.6rem',
    'font-size': '0.95rem',
    'line-height': '1.3',
    'font-family': 'Display',
    'font-weight': '500',
  },
};

const paragraphStyle = {
  margin: '0 0 1rem',
  'font-family': 'Body',
  'font-size': '1rem',
  'line-height': '1.7',
  color: 'var(--color-ink-muted)',
};

const listStyle = {
  margin: '0 0 1rem',
  'padding-left': '1.4rem',
  'font-family': 'Body',
  'font-size': '1rem',
  'line-height': '1.7',
  color: 'var(--color-ink-muted)',
};

const listItemStyle = {
  margin: '0 0 0.4rem',
  'padding-left': '0.25rem',
};

const accentParagraphStyle = {
  margin: '0 0 1.25rem',
  'font-family': 'Body',
  'font-size': '1rem',
  'font-weight': '600',
  'line-height': '1.2',
  'letter-spacing': '0.02em',
  color: 'var(--color-ink)',
};

export function UtilPlainText(props: {
  content: string;
  /** Render `- ` / `1. ` lines as real lists (off by default — see BULLET_RE). */
  lists?: boolean;
  /** Blog-post measure and Cyber Reader. Skips the wordmark, title, and date
   *  line so the caller can render those in a posts-article header. */
  variant?: 'legal' | 'post';
}) {
  const parsed = parseContent(props.content, props.lists ?? false);

  if (props.variant === 'post') {
    return <PostBody blocks={parsed.blocks} />;
  }

  return (
    // `.legal-doc` (measure, and the padding that clears the fixed header)
    // comes from src/app/routes/RouteLegal.css, which every route rendering
    // this variant imports.
    <main class="legal-doc">
      {parsed.eyebrow ? <div style={eyebrowStyle}>{parsed.eyebrow}</div> : null}

      <For each={parsed.blocks}>
        {(block) => {
          if (block.type === 'heading') {
            const style =
              headingStyles[Math.min(block.level, 4)] ?? headingStyles[4];
            const level = Math.min(block.level, 4);

            if (level === 1) return <h1 style={style}>{block.text}</h1>;
            if (level === 2) return <h2 style={style}>{block.text}</h2>;
            if (level === 3) return <h3 style={style}>{block.text}</h3>;
            return <h4 style={style}>{block.text}</h4>;
          }

          if (block.type === 'list') {
            const items = (
              <For each={block.items}>
                {(item) => <li style={listItemStyle}>{renderInline(item)}</li>}
              </For>
            );
            return block.ordered ? (
              <ol style={listStyle}>{items}</ol>
            ) : (
              <ul style={listStyle}>{items}</ul>
            );
          }

          const isAccent =
            block.text.startsWith('Last updated:') ||
            block.text.startsWith('Effective:');
          return (
            <p style={isAccent ? accentParagraphStyle : paragraphStyle}>
              {renderInline(block.text)}
            </p>
          );
        }}
      </For>
    </main>
  );
}

function PostBody(props: { blocks: Block[] }) {
  let skippedTitle = false;
  let skippedDate = false;
  const body = props.blocks.filter((block) => {
    if (!skippedTitle && block.type === 'heading' && block.level === 1) {
      skippedTitle = true;
      return false;
    }
    if (
      !skippedDate &&
      block.type === 'paragraph' &&
      (block.text.startsWith('Effective:') ||
        block.text.startsWith('Last updated:'))
    ) {
      skippedDate = true;
      return false;
    }
    return true;
  });

  return (
    <div class="post-body partners-terms-body">
      <For each={body}>
        {(block) => {
          if (block.type === 'heading') {
            const level = Math.min(block.level, 4);
            if (level === 2) return <h2>{block.text}</h2>;
            if (level === 3) return <h3>{block.text}</h3>;
            return <h4>{block.text}</h4>;
          }

          if (block.type === 'list') {
            const items = (
              <For each={block.items}>
                {(item) => <li>{renderInline(item, true)}</li>}
              </For>
            );
            return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
          }

          return <p>{renderInline(block.text, true)}</p>;
        }}
      </For>
    </div>
  );
}
