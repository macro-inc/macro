/** The existing Macro mention encoding; ordinary cell text is never Markdown. */
export type CellMention =
  | { type: 'user'; userId: string; email: string; displayName?: string }
  | {
      type: 'document';
      documentId: string;
      documentName: string;
      blockName: string;
      blockParams?: Record<string, string>;
    };
export type CellTextPart = { text: string; mention?: CellMention };
const blocks = new Set([
  'csv',
  'write',
  'automation',
  'pr',
  'md',
  'task',
  'snippet',
  'skill',
  'pdf',
  'docx',
  'spreadsheet',
  'canvas',
  'channel',
  'chat',
  'project',
  'email',
  'unknown',
  'code',
  'image',
  'video',
  'audio',
  'agent',
  'company',
  'contact',
  'calendar',
  'call',
]);

function mentionData(type: string, encoded: string): CellMention | undefined {
  try {
    const data = JSON.parse(encoded);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    const text = (key: string) =>
      typeof data[key] === 'string' &&
      data[key].length > 0 &&
      data[key].length <= 2048;
    if (
      type === 'user' &&
      text('userId') &&
      text('email') &&
      (data.displayName === undefined || typeof data.displayName === 'string')
    )
      return {
        type: 'user',
        userId: data.userId,
        email: data.email,
        displayName: data.displayName,
      };
    if (
      type === 'document' &&
      text('documentId') &&
      typeof data.documentName === 'string' &&
      blocks.has(data.blockName)
    ) {
      const params = data.blockParams;
      if (
        params !== undefined &&
        (!params ||
          typeof params !== 'object' ||
          Array.isArray(params) ||
          Object.values(params).some((v) => typeof v !== 'string'))
      )
        return;
      return {
        type: 'document',
        documentId: data.documentId,
        documentName: data.documentName,
        blockName: data.blockName,
        ...(params ? { blockParams: params } : {}),
      };
    }
  } catch {
    /* Malformed tags remain literal text. */
  }
}

export function cellTextParts(value: string): CellTextPart[] {
  if (!value.includes('<m-') || value.startsWith('=')) return [{ text: value }];
  const parts: CellTextPart[] = [];
  let end = 0;
  for (const match of value.matchAll(
    /<m-(user|document)-mention>(.*?)<\/m-\1-mention>/gs
  )) {
    const mention = mentionData(match[1], match[2]);
    if (!mention) continue;
    if (match.index > end) parts.push({ text: value.slice(end, match.index) });
    parts.push({ text: match[0], mention });
    end = match.index + match[0].length;
  }
  if (end < value.length) parts.push({ text: value.slice(end) });
  return parts.length ? parts : [{ text: value }];
}
export function cellMentionLabel(mention: CellMention): string {
  return mention.type === 'user'
    ? `@${mention.displayName || mention.email}`
    : mention.documentName || 'Linked item';
}
export function cellPlainText(value: string): string {
  return cellTextParts(value)
    .map((part) => (part.mention ? cellMentionLabel(part.mention) : part.text))
    .join('');
}
export function encodeCellMention(mention: CellMention): string {
  const { type, ...data } = mention;
  return `<m-${type}-mention>${JSON.stringify(data).replaceAll('<', '\\u003c')}</m-${type}-mention>`;
}

/** Only a text-token @ starts search; email addresses and formulas stay literal. */
export function cellMentionQuery(value: string, cursor: number) {
  if (value.startsWith('=')) return;
  let offset = 0;
  for (const part of cellTextParts(value)) {
    if (
      !part.mention &&
      cursor >= offset &&
      cursor <= offset + part.text.length
    ) {
      const before = part.text.slice(0, cursor - offset);
      const match = /(?:^|\s)@([^@\n<>]*)$/.exec(before);
      if (match)
        return {
          start: offset + before.lastIndexOf('@'),
          end: cursor,
          query: match[1],
        };
    }
    offset += part.text.length;
  }
}
