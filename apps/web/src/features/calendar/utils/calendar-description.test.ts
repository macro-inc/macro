// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { prepareCalendarDescription } from './calendar-description';

describe('prepareCalendarDescription', () => {
  it('converts a document mention to a portable Macro link', () => {
    const mention = JSON.stringify({
      documentId: '60617ec4-4c58-4e8b-90c6-445aa3172713',
      documentName: 'August Cycle Planning',
      blockName: 'md',
      blockParams: {},
    });
    const description = prepareCalendarDescription(
      `Review <m-document-mention>${mention}</m-document-mention>`
    );

    const body = new DOMParser().parseFromString(description, 'text/html').body;
    const link = body.querySelector('a');
    expect(link?.textContent).toBe('August Cycle Planning');
    expect(link?.href).toBe(
      `${window.location.origin}/app/md/60617ec4-4c58-4e8b-90c6-445aa3172713`
    );
  });

  it('preserves ordinary description content', () => {
    expect(prepareCalendarDescription('Agenda')).toBe('Agenda');
  });
});
