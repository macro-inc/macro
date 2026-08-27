import { describe, expect, it } from 'vitest';
import {
  type EventLocationSegment,
  isPhoneOnlyLocation,
  parseEventLocation,
} from './event-location';

/** The phone numbers a location was split into, with the URLs they dial. */
function phones(location: string) {
  return parseEventLocation(location)
    .filter((segment) => segment.kind === 'phone')
    .map((segment) => [segment.text, segment.telUrl]);
}

/** The location rebuilt from its segments, to prove nothing is dropped. */
function rejoin(segments: EventLocationSegment[]) {
  return segments.map((segment) => segment.text).join('');
}

describe('parseEventLocation', () => {
  it('dials a location that is only a phone number', () => {
    expect(parseEventLocation('+1 (555) 123-4567')).toEqual([
      {
        kind: 'phone',
        text: '+1 (555) 123-4567',
        telUrl: 'tel:+15551234567',
      },
    ]);
  });

  it.each([
    ['(555) 123-4567', 'tel:5551234567'],
    ['555-123-4567', 'tel:5551234567'],
    ['555.123.4567', 'tel:5551234567'],
    ['555 123 4567', 'tel:5551234567'],
    ['5551234567', 'tel:5551234567'],
    ['1-555-123-4567', 'tel:15551234567'],
    ['+44 20 7123 4567', 'tel:+442071234567'],
    ['+1 555 123 4567', 'tel:+15551234567'],
    ['+15551234567', 'tel:+15551234567'],
    // An en dash is what a paste from a formatted document brings along.
    ['555–123–4567', 'tel:5551234567'],
  ])('recognizes %s', (location, telUrl) => {
    expect(phones(location)).toEqual([[location, telUrl]]);
  });

  it('links the number inside a location that also names a place', () => {
    const segments = parseEventLocation("Joe's Diner, 555-123-4567");

    expect(segments).toEqual([
      { kind: 'text', text: "Joe's Diner, " },
      { kind: 'phone', text: '555-123-4567', telUrl: 'tel:5551234567' },
    ]);
    expect(rejoin(segments)).toBe("Joe's Diner, 555-123-4567");
  });

  it('keeps the text on both sides of the number', () => {
    const location = 'Dial-in: +1 555-123-4567 (guest line)';
    const segments = parseEventLocation(location);

    expect(segments).toEqual([
      { kind: 'text', text: 'Dial-in: ' },
      { kind: 'phone', text: '+1 555-123-4567', telUrl: 'tel:+15551234567' },
      { kind: 'text', text: ' (guest line)' },
    ]);
    expect(rejoin(segments)).toBe(location);
  });

  it('links every number when a location lists more than one', () => {
    expect(phones('Front desk 555-123-4567, mobile +1 555-987-6543')).toEqual([
      ['555-123-4567', 'tel:5551234567'],
      ['+1 555-987-6543', 'tel:+15559876543'],
    ]);
  });

  it('leaves the closing paren of a sentence out of the number', () => {
    expect(phones('Back room (call 5551234567)')).toEqual([
      ['5551234567', 'tel:5551234567'],
    ]);
  });

  it('keeps the parens a number is written with', () => {
    expect(phones('Reception (5551234567)')).toEqual([
      ['(5551234567)', 'tel:5551234567'],
    ]);
  });

  it.each([
    // Street numbers, suites, floors, and zips are all too short to dial.
    ['1600 Amphitheatre Parkway, Mountain View, CA 94043'],
    ['350 5th Ave, New York, NY 10118'],
    ['Building 12, Room 3456'],
    ['Suite 200-3000'],
    // Vanity numbers lose their digits to the letters.
    ['1-800-FLOWERS'],
    // A date carries phone-number digit counts once punctuation is stripped.
    ['2026-08-25 14'],
    ['8.25.2026 14'],
    // Too few digits to be a number, too many to be one.
    ['555-1234'],
    ['+1 555'],
    ['1234567890123456'],
    // An unpunctuated run past a national number reads as an identifier.
    ['Locker 123456789012'],
    ['https://meet.example.com/1234567890123'],
  ])('leaves %s as plain text', (location) => {
    expect(phones(location)).toEqual([]);
    expect(parseEventLocation(location)).toEqual([
      { kind: 'text', text: location },
    ]);
  });

  it.each([
    ['https://zoom.us/j/9876543210'],
    ['zoom.us/j/9876543210'],
    ['www.example.com/1234567890'],
    ['Meeting ID: 987 6543 210'],
    ['Access code 5551234567'],
  ])('leaves the digits of %s alone', (location) => {
    expect(phones(location)).toEqual([]);
  });

  it('dials the number of a dial-in without offering its PIN', () => {
    expect(phones('+1 555-123-4567,,9182736450#')).toEqual([
      ['+1 555-123-4567', 'tel:+15551234567'],
    ]);
  });

  it('trims the surrounding whitespace of a location', () => {
    expect(parseEventLocation('  555-123-4567  ')).toEqual([
      { kind: 'phone', text: '555-123-4567', telUrl: 'tel:5551234567' },
    ]);
  });

  it('returns a location with no number as one text segment', () => {
    expect(parseEventLocation('Conference Room B')).toEqual([
      { kind: 'text', text: 'Conference Room B' },
    ]);
  });
});

describe('isPhoneOnlyLocation', () => {
  it('is true for a location that is only a phone number', () => {
    expect(isPhoneOnlyLocation(parseEventLocation('+1 555-123-4567'))).toBe(
      true
    );
  });

  it.each([["Joe's Diner, 555-123-4567"], ['Conference Room B'], ['']])(
    'is false for %s',
    (location) => {
      expect(isPhoneOnlyLocation(parseEventLocation(location))).toBe(false);
    }
  );
});
