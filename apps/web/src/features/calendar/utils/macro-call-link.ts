interface CalendarCallContent {
  conferenceUrl?: string | null;
  location?: string | null;
  description?: string | null;
}

/** Accept only Macro meeting links, including local development links. */
export function macroCallUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const local =
      url.hostname === 'localhost' ||
      url.hostname.endsWith('.localhost') ||
      url.hostname === '127.0.0.1';
    if (
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      (!local &&
        url.hostname !== 'macro.com' &&
        url.hostname !== 'dev.macro.com') ||
      url.username ||
      url.password ||
      !/^\/app\/meet\/[A-Za-z0-9_-]{16,128}\/?$/.test(url.pathname)
    ) {
      return undefined;
    }
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/$/, '');
    return url.toString();
  } catch {
    return undefined;
  }
}

/** The shared meeting travels in ordinary calendar fields and external invites. */
export function calendarMacroCallUrl(event: CalendarCallContent) {
  for (const content of [
    event.conferenceUrl,
    event.location,
    event.description,
  ]) {
    for (const candidate of content?.match(/https?:\/\/[^\s<>"']+/gi) ?? []) {
      const url = macroCallUrl(candidate.replace(/&amp;/g, '&'));
      if (url) return url;
    }
  }
  return undefined;
}

/** Remove only the paragraph generated for this meeting, preserving user text. */
export function removeCalendarMacroCall(
  content: Pick<CalendarCallContent, 'description' | 'location'>,
  existingUrl: string | undefined
) {
  const description = content.description ?? '';
  const location = content.location ?? '';
  if (!existingUrl) return { description, location };
  return {
    description: description
      .replace(
        /<(p|div)\b[^>]*>(?:(?!<(?:p|div)\b)[\s\S])*?<\/\1>/gi,
        (paragraph) => {
          const text = paragraph
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .trim();
          const generated =
            text === `Join Macro call: ${existingUrl}` ||
            text === 'Join Macro call';
          return generated &&
            calendarMacroCallUrl({ description: paragraph }) === existingUrl
            ? ''
            : paragraph;
        }
      )
      .trim(),
    location: macroCallUrl(location.trim()) === existingUrl ? '' : location,
  };
}

/** Attach one invitation link without replacing a physical location or notes. */
export function attachCalendarMacroCall(
  content: Pick<CalendarCallContent, 'description' | 'location'>,
  url: string,
  existingUrl?: string
) {
  const clean = removeCalendarMacroCall(content, existingUrl ?? url);
  return {
    description: `${clean.description}${clean.description ? '\n' : ''}<p>Join Macro call: <a href="${url}">${url}</a></p>`,
    location: clean.location.trim() ? clean.location : url,
  };
}
