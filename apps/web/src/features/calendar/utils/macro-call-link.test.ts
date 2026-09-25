import { describe, expect, it } from 'vitest';
import {
  attachCalendarMacroCall,
  calendarMacroCallUrl,
  macroCallUrl,
  removeCalendarMacroCall,
} from './macro-call-link';

const URL = 'https://macro.com/app/meet/8m8mGwzHqxzYjeIN5-nJRquRbzyTEhGF';
const SETUP_URL = URL.replace('/meet/', '/meet/join/');

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

  it('recognizes setup links and UUID links alongside saved legacy invitations', () => {
    for (const url of [
      SETUP_URL,
      'https://macro.com/app/meet/join/01955c94-2576-7f3a-9d60-173d74b7f812',
      'https://macro.com/meet/join/01955c94-2576-7f3a-9d60-173d74b7f812',
      URL,
    ]) {
      expect(
        calendarMacroCallUrl({ location: `${url}/?source=calendar` })
      ).toBe(url);
    }
  });

  it('rejects lookalike sites, credentials, unsafe protocols and malformed routes', () => {
    for (const candidate of [
      URL.replace('macro.com', 'macro.com.evil.test'),
      URL.replace('macro.com', 'macro.com@evil.test'),
      URL.replace('https:', 'javascript:'),
      URL.replace('https:', 'http:'),
      `${URL}/extra`,
      'https://macro.com/app/meet/short',
      'https://macro.com/app/meet/new',
      'https://macro.com/app/meet/join',
      'https://macro.com/app/meet/join/short',
      `${SETUP_URL}/extra`,
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

  it('replaces a generated legacy invitation with the setup link without losing notes', () => {
    const legacy = attachCalendarMacroCall(
      { description: '<p>Notes</p>' },
      URL
    );
    const updated = attachCalendarMacroCall(legacy, SETUP_URL, URL);
    expect(updated.location).toBe(SETUP_URL);
    expect(calendarMacroCallUrl(updated)).toBe(SETUP_URL);
    expect(removeCalendarMacroCall(updated, SETUP_URL)).toEqual({
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
