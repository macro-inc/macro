import { describe, expect, it } from 'vitest';
import {
  attachCalendarMacroCall,
  calendarMacroCallUrl,
  macroCallUrl,
  removeCalendarMacroCall,
} from './macro-call-link';

const URL = 'https://macro.com/app/meet/8m8mGwzHqxzYjeIN5-nJRquRbzyTEhGF';

describe('Macro calendar call links', () => {
  it('recognizes shared links in invitations and drops autojoin parameters', () => {
    expect(
      calendarMacroCallUrl({
        description: `<p>Join <a href="${URL}?join=true&amp;source=calendar">the call</a></p>`,
      })
    ).toBe(URL);
    expect(
      macroCallUrl(
        'http://localhost:3003/app/meet/8m8mGwzHqxzYjeIN5-nJRquRbzyTEhGF'
      )
    ).toBe('http://localhost:3003/app/meet/8m8mGwzHqxzYjeIN5-nJRquRbzyTEhGF');
  });

  it('rejects lookalike sites, credentials, unsafe protocols and malformed routes', () => {
    for (const candidate of [
      URL.replace('macro.com', 'macro.com.evil.test'),
      URL.replace('macro.com', 'macro.com@evil.test'),
      URL.replace('https:', 'javascript:'),
      URL.replace('https:', 'http:'),
      `${URL}/extra`,
      'https://macro.com/app/meet/short',
    ]) {
      expect(macroCallUrl(candidate)).toBeUndefined();
    }
  });

  it('keeps notes and a physical room while adding a portable invitation link', () => {
    const content = attachCalendarMacroCall(
      {
        description: '<p>Bring the roadmap.</p>',
        location: 'Room 2',
      },
      URL
    );
    expect(content.location).toBe('Room 2');
    expect(content.description).toContain('<p>Bring the roadmap.</p>');
    expect(content.description).toContain(`<a href="${URL}">${URL}</a>`);
    expect(calendarMacroCallUrl(content)).toBe(URL);
  });

  it('does not duplicate the generated link when saving an existing or recurring call', () => {
    const initial = attachCalendarMacroCall(
      { description: '<p>Notes</p>' },
      URL
    );
    expect(attachCalendarMacroCall(initial, URL)).toEqual(initial);
    expect(removeCalendarMacroCall(initial, URL)).toEqual({
      description: '<p>Notes</p>',
      location: '',
    });
  });

  it('preserves independently authored call links and other description content', () => {
    const content = {
      description: `<p>Related call: <a href="${URL}">prior discussion</a></p>`,
      location: 'Room 2',
    };
    expect(removeCalendarMacroCall(content, URL)).toEqual(content);
  });
});
