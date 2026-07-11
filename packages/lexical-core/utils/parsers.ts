export function parseUserMentions(text: string): string {
  return text.replace(/<m-user-mention>(.*?)<\/m-user-mention>/g, (_, json) => {
    try {
      const data = JSON.parse(json);
      return data.email || '';
    } catch {
      return '';
    }
  });
}

export function parseContactMentions(text: string): string {
  return text.replace(
    /<m-contact-mention>(.*?)<\/m-contact-mention>/g,
    (_, json) => {
      try {
        const data = JSON.parse(json);
        return data.name || data.emailOrDomain || '';
      } catch {
        return '';
      }
    }
  );
}

export function parseDateMentions(text: string): string {
  return text.replace(/<m-date-mention>(.*?)<\/m-date-mention>/g, (_, json) => {
    try {
      const data = JSON.parse(json);
      return data.displayFormat || '';
    } catch {
      return '';
    }
  });
}

export function parseDocumentMentions(text: string): string {
  return text.replace(
    /<m-document-mention>(.*?)<\/m-document-mention>/g,
    (_, json) => {
      try {
        const data = JSON.parse(json);
        return data.documentName || '';
      } catch {
        return '';
      }
    }
  );
}

export function parsePullRequestMentions(text: string): string {
  return text.replace(/<m-pr-mention>(.*?)<\/m-pr-mention>/g, (_, json) => {
    try {
      const data = JSON.parse(json);
      return data.label || data.id || '';
    } catch {
      return '';
    }
  });
}

export function parseLinks(text: string): string {
  return text.replace(/<m-link>(.*?)<\/m-link>/g, (_, json) => {
    try {
      const data = JSON.parse(json);
      return data.text || data.url || '';
    } catch {
      return '';
    }
  });
}

export function parseGroupMentions(text: string): string {
  return text.replace(
    /<m-group-mention>(.*?)<\/m-group-mention>/g,
    (_, json) => {
      try {
        const data = JSON.parse(json);
        return `@${data.groupAlias || ''}`;
      } catch {
        return '';
      }
    }
  );
}

export function parseDocumentCards(text: string): string {
  return text.replace(
    /<m-document-card>(.*?)<\/m-document-card>/g,
    (_, json) => {
      try {
        const data = JSON.parse(json);
        return data.documentName || '';
      } catch {
        return '';
      }
    }
  );
}

export function parseSnapshots(text: string): string {
  return text.replace(/<m-snapshot>(.*?)<\/m-snapshot>/g, (_, encoded) => {
    try {
      // Decode base64 (may also be raw JSON for backward compat)
      const jsonStr = encoded.startsWith('{')
        ? encoded
        : new TextDecoder().decode(
            Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
          );
      const data = JSON.parse(jsonStr);
      return data.documentName || '';
    } catch {
      return '';
    }
  });
}

/**
 * Converts markdown text with XML mention tags to plain text.
 * Extracts the readable text from mention nodes:
 * - User mentions: email
 * - Contact mentions: name (fallback to emailOrDomain)
 * - Date mentions: displayFormat
 * - Document mentions: documentName
 * - Document cards: documentName
 * - Snapshots: documentName (base64-encoded payload)
 * - Group mentions: @groupAlias (e.g., @here)
 * - Links: text (fallback to url)
 */
export function markdownToPlainText(markdown: string): string {
  return parseLinks(
    parseDocumentCards(
      parseSnapshots(
        parsePullRequestMentions(
          parseDocumentMentions(
            parseGroupMentions(
              parseDateMentions(
                parseContactMentions(parseUserMentions(markdown))
              )
            )
          )
        )
      )
    )
  );
}

/**
 * The payload fields `markdownToEmbeddingText` reads across the internal
 * format's `<m-*>` JSON tags. Each tag uses a small subset of these.
 */
type MentionTagPayload = {
  documentId?: string;
  documentName?: string;
  blockName?: string;
  blockParams?: { channel_message_id?: string };
  label?: string;
  url?: string;
  text?: string;
  alt?: string;
  id?: string;
  srcType?: string;
  email?: string;
  name?: string;
  emailOrDomain?: string;
  displayFormat?: string;
  groupAlias?: string;
  equation?: string;
};

/**
 * Replaces every `<{tag}>{json}</{tag}>` occurrence with `render(payload)`.
 * Unparseable payloads are dropped rather than left in place.
 */
function replaceJsonTag(
  text: string,
  tag: string,
  render: (data: MentionTagPayload) => string
): string {
  return text.replace(new RegExp(`<${tag}>(.*?)</${tag}>`, 'gs'), (_, json) => {
    try {
      return render(JSON.parse(json));
    } catch {
      return '';
    }
  });
}

function documentRefToEmbeddingText(data: MentionTagPayload): string {
  const name = data.documentName || '';
  if (!data.documentId) return name;
  const blockName = data.blockName || 'document';
  const channelMessageId = data.blockParams?.channel_message_id;
  const suffix = channelMessageId ? `#${channelMessageId}` : '';
  return `[${name}](${blockName}:${data.documentId}${suffix})`;
}

/** Snapshot payloads may be base64-encoded (or raw JSON for backward compat). */
function snapshotToEmbeddingText(encoded: string): string {
  try {
    const json = encoded.startsWith('{')
      ? encoded
      : new TextDecoder().decode(
          Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
        );
    return documentRefToEmbeddingText(JSON.parse(json));
  } catch {
    return '';
  }
}

/**
 * Flattens `<m-table>` markup into plain rows: one line per row, cells joined
 * with ` | `. Cell payloads are markdown with newlines escaped as literal
 * `\n`; any tags nested in cells are handled by the leaf passes afterwards.
 */
function flattenTables(text: string): string {
  return text.replace(/<m-table>(.*?)<\/m-table>/gs, (_, table: string) =>
    [...table.matchAll(/<m-table-row>(.*?)<\/m-table-row>/gs)]
      .map((row) =>
        [...row[1].matchAll(/<m-table-cell>(.*?)<\/m-table-cell>/gs)]
          .map((cell) =>
            cell[1].replace(/\\n/g, ' ').replaceAll('<br>', ' ').trim()
          )
          .join(' | ')
      )
      .join('\n')
  );
}

/**
 * Unwraps `<m-email-thread-embed>` blocks: the payload is a JSON metadata
 * object immediately followed by the quoted thread's markdown with newlines
 * escaped as literal `\n`.
 */
function flattenEmailThreadEmbeds(text: string): string {
  return text.replace(
    /<m-email-thread-embed>(.*?)<\/m-email-thread-embed>/gs,
    (_, embed: string) => embed.replace(/^\{.*?\}/, '').replace(/\\n/g, '\n')
  );
}

/**
 * Converts internal markdown to compact, embedding-friendly text for task
 * dedup. Every internal-format `<m-*>` tag is reduced to the identity that
 * distinguishes it, dropping the JSON boilerplate that is the same in every
 * tag:
 * - Document mentions/cards/snapshots: `[documentName](blockName:documentId)`,
 *   with `#channel_message_id` appended when the mention targets a channel
 *   message
 * - Links: `[text](url)`; videos: `[video](url)`; images: `[alt](dss:id|url)`
 * - User mentions: email; contacts: name; dates: display format;
 *   groups: `@alias`; themes: name; equations: the source expression;
 *   awaits: placeholder text
 * - Tables and email-thread embeds are flattened to their inner text
 * - Watermarks and unrecognized `m-*` tags are dropped entirely
 *
 * This is the format the task dedup backend embeds: the task composer sends it
 * directly to the similarity-search endpoint, and lexical-service produces it
 * for stored tasks via the markdown endpoint's `embedding` target. Both sides
 * must agree, so any change here changes what new embeddings look like and
 * may warrant re-running the task embedding backfill.
 */
export function markdownToEmbeddingText(markdown: string): string {
  // Containers first: their payloads nest further tags that the leaf passes
  // below pick up.
  let text = markdown.replace(
    /<m-snapshot>(.*?)<\/m-snapshot>/gs,
    (_, encoded) => snapshotToEmbeddingText(encoded)
  );
  text = flattenTables(text);
  text = flattenEmailThreadEmbeds(text);

  // Leaf tags.
  text = replaceJsonTag(text, 'm-document-mention', documentRefToEmbeddingText);
  text = replaceJsonTag(text, 'm-document-card', documentRefToEmbeddingText);
  text = replaceJsonTag(text, 'm-pr-mention', (data) =>
    data.id
      ? `[${data.label || 'Pull request'}](pr:${data.id})`
      : data.label || ''
  );
  text = replaceJsonTag(text, 'm-link', (data) =>
    data.url ? `[${data.text || data.url}](${data.url})` : data.text || ''
  );
  text = replaceJsonTag(text, 'm-image', (data) => {
    // dss images get a stable id; urls elsewhere may be transient.
    const target =
      data.srcType === 'dss' && data.id ? `dss:${data.id}` : data.url;
    return target ? `[${data.alt || 'image'}](${target})` : data.alt || '';
  });
  text = replaceJsonTag(text, 'm-video', (data) =>
    data.url ? `[video](${data.url})` : ''
  );
  text = replaceJsonTag(
    text,
    'm-katex-equation',
    (data) => data.equation || ''
  );
  text = replaceJsonTag(text, 'm-user-mention', (data) => data.email || '');
  text = replaceJsonTag(
    text,
    'm-contact-mention',
    (data) => data.name || data.emailOrDomain || ''
  );
  text = replaceJsonTag(
    text,
    'm-date-mention',
    (data) => data.displayFormat || ''
  );
  text = replaceJsonTag(
    text,
    'm-group-mention',
    (data) => `@${data.groupAlias || ''}`
  );
  text = replaceJsonTag(text, 'm-theme-mention', (data) => data.name || '');
  text = replaceJsonTag(text, 'm-await', (data) => data.text || '');
  text = replaceJsonTag(text, 'm-watermark', () => '');

  // Anything still tagged is an unrecognized m-* node: drop it entirely so
  // its payload cannot leak boilerplate into the embedding (the string
  // analogue of the UNKNOWN_MENTION fallback transformer).
  return text.replace(/<(m-[a-zA-Z0-9_-]+)>(.*?)<\/\1>/gs, '');
}
