// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { prepareCalendarDescriptionFromHtml } from './calendar-description';

describe('prepareCalendarDescriptionFromHtml', () => {
  it('converts a document mention to a portable Macro link', () => {
    const description = prepareCalendarDescriptionFromHtml(`
      <p>Review <span
        data-document-mention="true"
        data-document-id="60617ec4-4c58-4e8b-90c6-445aa3172713"
        data-document-name="August Cycle Planning"
        data-block-name="md"
      >August Cycle Planning</span></p>
    `);

    const body = new DOMParser().parseFromString(description, 'text/html').body;
    const link = body.querySelector('a');
    expect(link?.textContent).toBe('August Cycle Planning');
    expect(link?.href).toBe(
      `${window.location.origin}/app/md/60617ec4-4c58-4e8b-90c6-445aa3172713`
    );
  });

  it('preserves the exported display form of non-document mentions', () => {
    const description = prepareCalendarDescriptionFromHtml(`
      <p>
        <span data-user-mention="true">Teo Nys</span>
        <span data-contact-mention="true">GlycoTech</span>
        <span data-group-mention="true">@engineering</span>
        <span data-date-mention="true">Today</span>
      </p>
    `);
    const body = new DOMParser().parseFromString(description, 'text/html').body;

    expect(body.querySelector('[data-user-mention]')?.textContent).toBe(
      'Teo Nys'
    );
    expect(body.querySelector('[data-contact-mention]')?.textContent).toBe(
      'GlycoTech'
    );
    expect(body.querySelector('[data-group-mention]')?.textContent).toBe(
      '@engineering'
    );
    expect(body.querySelector('[data-date-mention]')?.textContent).toBe(
      'Today'
    );
  });
});
