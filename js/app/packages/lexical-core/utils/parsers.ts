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

/**
 * Converts markdown text with XML mention tags to plain text.
 * Extracts the readable text from mention nodes:
 * - User mentions: email
 * - Contact mentions: name (fallback to emailOrDomain)
 * - Date mentions: displayFormat
 * - Document mentions: documentName
 * - Group mentions: @groupAlias (e.g., @here)
 * - Links: text (fallback to url)
 */
export function markdownToPlainText(markdown: string): string {
  return parseLinks(
    parseDocumentMentions(
      parseGroupMentions(
        parseDateMentions(parseContactMentions(parseUserMentions(markdown)))
      )
    )
  );
}
