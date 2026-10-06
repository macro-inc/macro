/**
 * Adapted from diffd web/src/lib/render.ts at 91a5e3e.
 * Copyright (c) 2026 Wolf Mermelstein. MIT; see ../DIFFD_LICENSE.
 * Static escaped code lets a window of rows render without token subscriptions.
 */
const SYNTAX = [
  'keyword',
  'string',
  'comment',
  'constant',
  'number',
  'function',
  'type',
  'variable',
  'property',
  'attribute',
  'tag',
  'operator',
  'punctuation',
  'module',
  'escape',
  'heading',
  'link',
] as const;

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (character) => ESCAPES[character]);
}

/** All generated class names are static; every source segment is escaped. */
export function lineHtml(
  text: string,
  syntax: readonly number[] = [],
  novel: readonly number[] = [],
  side: 'old' | 'new' = 'new'
): string {
  const cuts = new Set([0, text.length]);
  for (let index = 0; index + 2 < syntax.length; index += 3) {
    cuts.add(syntax[index]);
    cuts.add(syntax[index + 1]);
  }
  for (const offset of novel) cuts.add(offset);
  const points = [...cuts]
    .filter((point) => point >= 0 && point <= text.length)
    .sort((a, b) => a - b);
  let result = '';
  let syntaxIndex = 0;
  let novelIndex = 0;
  for (let index = 0; index + 1 < points.length; index++) {
    const start = points[index];
    const end = points[index + 1];
    while (syntaxIndex + 2 < syntax.length && syntax[syntaxIndex + 1] <= start)
      syntaxIndex += 3;
    while (novelIndex + 1 < novel.length && novel[novelIndex + 1] <= start)
      novelIndex += 2;
    const classes: string[] = [];
    if (
      syntaxIndex + 2 < syntax.length &&
      syntax[syntaxIndex] <= start &&
      end <= syntax[syntaxIndex + 1]
    ) {
      const kind = SYNTAX[syntax[syntaxIndex + 2]];
      if (kind) classes.push(`review-syntax-${kind}`);
    }
    if (
      novelIndex + 1 < novel.length &&
      novel[novelIndex] <= start &&
      end <= novel[novelIndex + 1]
    )
      classes.push(
        side === 'old' ? 'review-token-deleted' : 'review-token-added'
      );
    const segment = escapeHtml(text.slice(start, end));
    result += classes.length
      ? `<span class="${classes.join(' ')}">${segment}</span>`
      : segment;
  }
  return result;
}
