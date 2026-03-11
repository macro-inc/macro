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
        parseDocumentMentions(
          parseGroupMentions(
            parseDateMentions(parseContactMentions(parseUserMentions(markdown)))
          )
        )
      )
    )
  );
}
