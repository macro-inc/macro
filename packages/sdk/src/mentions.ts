import type { SimpleMention } from '../generated/storage/types.gen';

export type { SimpleMention };

/** The two things a mentionable entity contributes to a message. */
export interface MentionPart {
  /** The `<m-*>` tag written into the message content. */
  tag: string;
  /** The parallel entry the backend uses for notifications and permissions. */
  mention: SimpleMention;
}

/** Anything that can be dropped into a {@link msg} template as a mention. */
export interface Mentionable {
  toMention(): MentionPart;
}

/** What may be interpolated into a {@link msg} template: a mention, or plain text. */
export type Interpolation = Mentionable | string | number;

/** A composed message body: content with embedded tags, and the matching mentions. */
export interface RichMessage {
  content: string;
  mentions: SimpleMention[];
}

/** Serialize a mention node to its `<tag>{json}</tag>` wire form. */
export function wrapXml(tag: string, data: unknown): string {
  return `<${tag}>${JSON.stringify(data)}</${tag}>`;
}

function isMentionable(value: Interpolation): value is Mentionable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.toMention === 'function'
  );
}

/** The `@here` group mention. */
export const here: Mentionable = {
  toMention: () => ({
    tag: wrapXml('m-group-mention', { groupAlias: 'here' }),
    mention: { entity_type: 'group', entity_id: 'here' },
  }),
};

/**
 * Compose a rich message. Interpolate mentions (a {@link User}, {@link Document},
 * {@link here}, …) or plain strings. Each mention writes its `<m-*>` tag into the
 * content *and* adds itself to `mentions[]`, so the two can never drift; strings
 * are inserted as-is, so markdown like `**bold**` passes through untouched.
 *
 * @example
 * channel.send(msg`Hey ${user}, see ${doc}. cc ${here}`);
 * channel.send(msg`Status: ${status} — see ${doc}`);
 */
export function msg(
  strings: TemplateStringsArray,
  ...values: Interpolation[]
): RichMessage {
  let content = '';
  const mentions: SimpleMention[] = [];

  for (const [i, string] of strings.entries()) {
    content += string;

    if (i >= values.length) continue;

    const value = values[i];
    if (isMentionable(value)) {
      const part = value.toMention();
      content += part.tag;
      mentions.push(part.mention);
    } else {
      content += String(value);
    }
  }

  return { content, mentions: dedupe(mentions) };
}

function dedupe(mentions: SimpleMention[]): SimpleMention[] {
  const seen = new Set<string>();
  return mentions.filter((m) => {
    const key = `${m.entity_type}:${m.entity_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Normalize a plain string or a {@link RichMessage} to the wire shape. */
export function toBody(body: string | RichMessage): RichMessage {
  return typeof body === 'string' ? { content: body, mentions: [] } : body;
}
