/**
 * Recognizes phone numbers written into an event's location field — a
 * restaurant's number, a dial-in line, a "call me at …" — so a reader can
 * place the call from the event itself instead of retyping the digits.
 */

/** A run of an event location: literal text, or a dialable phone number. */
export type EventLocationSegment =
  | { kind: 'text'; text: string }
  | { kind: 'phone'; text: string; telUrl: string };

/** Punctuation phone numbers are written with, between their digits. */
const PHONE_PUNCTUATION = /[ \u00a0().\u2010-\u2015-]/;

/**
 * Runs of digits and phone punctuation. Deliberately loose: every match is put
 * through {@link toTelUrl} and {@link isDialable}, which decide what is
 * actually a number to call.
 */
const PHONE_RUN = /\+?\(?\d[\d \u00a0().\u2010-\u2015-]*/g;

/**
 * A leading date. "2026-08-25 14" carries as many digits as a phone number
 * once its punctuation is stripped, and is never something to call.
 */
const LEADING_DATE =
  /^\d{1,4}[.\u2010-\u2015-]\d{1,2}[.\u2010-\u2015-]\d{2,4}(?=$|\s)/;

/** Links, whose digits belong to a meeting URL rather than to a number. */
const LINK = /\S+:\/\/\S+|\bwww\.\S+/g;

/**
 * A label that turns the digits after it into something other than a number to
 * call — a meeting ID, an access code — however phone-like their length.
 */
const NON_DIALABLE_LABEL = /\b(?:id|code|pin|passcode|password)\W*$/i;

/**
 * Characters that, flush against a run, mark its digits as something else: a
 * conference PIN ("…4567,,918273#") or a path or query inside a bare link.
 */
const NON_DIALABLE_PREFIXES = new Set([',', ';', '/', '=']);

/** The most digits E.164 allows, country code included. */
const MAX_E164_DIGITS = 15;
/** The fewest digits a number carrying an explicit country code can have. */
const MIN_INTERNATIONAL_DIGITS = 8;
/** The fewest digits a number without a country code can have. */
const MIN_NATIONAL_DIGITS = 10;
/** The most digits an unpunctuated run may have to still read as a number. */
const MAX_UNPUNCTUATED_DIGITS = 11;

/** Half-open `[start, end)` bounds of a run of a location. */
type Range = readonly [start: number, end: number];

/**
 * Drops the trailing punctuation the run regex swept up, which belongs to the
 * surrounding sentence rather than to the number.
 */
function trimTrailingText(candidate: string): string {
  let value = candidate.replace(/[^\d)]+$/, '');
  // A closing paren is part of the number only when it closes one inside it:
  // "(555) 123-4567" keeps its parens, "(dial 5551234567)" does not.
  while (value.endsWith(')') && !value.includes('(')) {
    value = value.slice(0, -1).replace(/[^\d)]+$/, '');
  }
  return value;
}

/** The `tel:` URL for a candidate run, or undefined when it isn't a number. */
function toTelUrl(candidate: string): string | undefined {
  if (LEADING_DATE.test(candidate)) return undefined;

  const digits = candidate.replace(/\D/g, '');
  if (digits.length > MAX_E164_DIGITS) return undefined;

  // A country code states the intent outright, so the full E.164 range is fair
  // game — including the short national numbers some countries still use.
  if (candidate.startsWith('+')) {
    return digits.length >= MIN_INTERNATIONAL_DIGITS
      ? `tel:+${digits}`
      : undefined;
  }

  // Without one, length is most of what marks a number as a number, so accept
  // only what subscriber numbers actually use. That leaves street numbers,
  // suite numbers, zip codes, and years alone. A run with no punctuation at
  // all has nothing but its length going for it, so it is held tighter still.
  const maxDigits = PHONE_PUNCTUATION.test(candidate)
    ? MAX_E164_DIGITS
    : MAX_UNPUNCTUATED_DIGITS;
  return digits.length >= MIN_NATIONAL_DIGITS && digits.length <= maxDigits
    ? `tel:${digits}`
    : undefined;
}

/**
 * Whether a run is a number to call rather than digits that merely look like
 * one — a conference PIN, a meeting ID, part of a link. The markers have to
 * sit flush against the run, so the comma in "Joe's Diner, 555-123-4567"
 * leaves its number dialable.
 */
function isDialable(location: string, run: Range, links: Range[]): boolean {
  const [start, end] = run;
  if (links.some(([from, to]) => start < to && end > from)) return false;
  if (NON_DIALABLE_PREFIXES.has(location[start - 1] ?? '')) return false;
  if (location[end] === '#') return false;
  return !NON_DIALABLE_LABEL.test(location.slice(0, start));
}

/**
 * Splits an event location into its text and its dialable phone numbers, in
 * order. A location with no number in it comes back as a single text segment.
 */
export function parseEventLocation(location: string): EventLocationSegment[] {
  const trimmed = location.trim();
  const links: Range[] = Array.from(
    trimmed.matchAll(LINK),
    (match) => [match.index, match.index + match[0].length] as const
  );
  const segments: EventLocationSegment[] = [];
  let index = 0;

  for (const match of trimmed.matchAll(PHONE_RUN)) {
    const candidate = trimTrailingText(match[0]);
    if (!candidate) continue;

    const start = match.index;
    const end = start + candidate.length;
    if (!isDialable(trimmed, [start, end], links)) continue;

    const telUrl = toTelUrl(candidate);
    if (!telUrl) continue;

    if (start > index) {
      segments.push({ kind: 'text', text: trimmed.slice(index, start) });
    }
    segments.push({ kind: 'phone', text: candidate, telUrl });
    index = end;
  }

  if (index < trimmed.length) {
    segments.push({ kind: 'text', text: trimmed.slice(index) });
  }

  return segments;
}

/**
 * Whether the location is a phone number and nothing else, so a caller can
 * lead with a phone icon instead of a map pin.
 */
export function isPhoneOnlyLocation(segments: EventLocationSegment[]) {
  return segments.length === 1 && segments[0]?.kind === 'phone';
}
