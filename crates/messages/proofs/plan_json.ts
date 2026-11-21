// JSON reading and writing for channel_change_plans.ts.
//
// EXPLAIN output distinguishes whole numbers (`"Plan Rows": 1`) from decimals
// (`"Actual Total Time": 0.010`), and summary.json must keep that distinction
// and the key order. `JSON.parse` loses both, so integers are read as bigint,
// decimals as number and objects as Map. The non-standard `NaN` and `Infinity`
// literals, which PostgreSQL does not emit, are not accepted.

export type Json =
  | null
  | boolean
  | bigint
  | number
  | string
  | Json[]
  | Map<string, Json>;

/** A decoded value and the index just past its last character. */
type Decoded = { value: Json; end: number };

const NUMBER = /(-?(?:0|[1-9]\d*))(\.\d+)?([eE][-+]?\d+)?/y;
const WHITESPACE = /[ \t\n\r]*/y;
const LITERALS: [string, Json][] = [
  ['null', null],
  ['true', true],
  ['false', false],
];

function skipWhitespace(text: string, position: number): number {
  WHITESPACE.lastIndex = position;
  return position + (WHITESPACE.exec(text)?.[0].length ?? 0);
}

function decodeString(text: string, start: number): Decoded | undefined {
  let end = start + 1;

  while (end < text.length && text[end] !== '"') {
    end += text[end] === '\\' ? 2 : 1;
  }
  if (end >= text.length) {
    return undefined;
  }

  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return typeof value === 'string' ? { value, end: end + 1 } : undefined;
  } catch {
    return undefined;
  }
}

// Decodes the items of an array or the members of an object, which share
// their separators. `start` is the index of the opening bracket.
function decodeContainer(text: string, start: number): Decoded | undefined {
  const isObject = text[start] === '{';
  const closing = isObject ? '}' : ']';
  const items: Json[] = [];
  const members = new Map<string, Json>();
  const value = isObject ? members : items;
  let position = skipWhitespace(text, start + 1);

  if (text[position] === closing) {
    return { value, end: position + 1 };
  }

  while (true) {
    if (isObject) {
      const key =
        text[position] === '"' ? decodeString(text, position) : undefined;
      if (!key || typeof key.value !== 'string') {
        return undefined;
      }

      position = skipWhitespace(text, key.end);
      if (text[position] !== ':') {
        return undefined;
      }

      const member = decodeJsonAt(text, skipWhitespace(text, position + 1));
      if (!member) {
        return undefined;
      }
      members.set(key.value, member.value);
      position = skipWhitespace(text, member.end);
    } else {
      const item = decodeJsonAt(text, position);
      if (!item) {
        return undefined;
      }
      items.push(item.value);
      position = skipWhitespace(text, item.end);
    }

    if (text[position] === closing) {
      return { value, end: position + 1 };
    }
    if (text[position] !== ',') {
      return undefined;
    }
    position = skipWhitespace(text, position + 1);
  }
}

/**
 * Decodes the JSON value that starts exactly at `start`, ignoring whatever
 * follows it. Returns undefined when no valid value starts there.
 */
export function decodeJsonAt(text: string, start: number): Decoded | undefined {
  const first = text[start];

  if (first === '"') {
    return decodeString(text, start);
  }
  if (first === '{' || first === '[') {
    return decodeContainer(text, start);
  }

  for (const [literal, value] of LITERALS) {
    if (text.startsWith(literal, start)) {
      return { value, end: start + literal.length };
    }
  }

  NUMBER.lastIndex = start;
  const number = NUMBER.exec(text);
  if (!number) {
    return undefined;
  }

  const isInteger = number[2] === undefined && number[3] === undefined;
  return {
    value: isInteger ? BigInt(number[0]) : Number(number[0]),
    end: start + number[0].length,
  };
}

/**
 * The shortest decimal text that reads back as the same number, always with a
 * decimal point or exponent: `0.01`, `12.0`, `1e-05`, `1.5e+16`.
 */
export function decimalText(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`cannot write the non-finite number ${value}`);
  }
  if (value === 0) {
    return Object.is(value, -0) ? '-0.0' : '0.0';
  }

  // toExponential() without a digit count gives the shortest round-trip digits.
  const [mantissa = '', exponentText = ''] = Math.abs(value)
    .toExponential()
    .split('e');
  const digits = mantissa.replace('.', '');
  const exponent = Number(exponentText);
  const sign = value < 0 ? '-' : '';

  if (exponent < -4 || exponent >= 16) {
    const fraction = digits.length > 1 ? `.${digits.slice(1)}` : '';
    const exponentSign = exponent < 0 ? '-' : '+';
    const exponentDigits = String(Math.abs(exponent)).padStart(2, '0');
    return `${sign}${digits[0]}${fraction}e${exponentSign}${exponentDigits}`;
  }

  if (exponent < 0) {
    return `${sign}0.${'0'.repeat(-exponent - 1)}${digits}`;
  }

  if (digits.length <= exponent + 1) {
    return `${sign}${digits.padEnd(exponent + 1, '0')}.0`;
  }

  return `${sign}${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}`;
}

/** A whole number as written, a decimal as `decimalText`. */
export function numberText(value: Json): string {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'number') {
    return decimalText(value);
  }

  throw new Error(`expected a number, found ${typeof value}`);
}

function encodeString(value: string): string {
  // Everything outside printable ASCII is written as a \u escape.
  return JSON.stringify(value).replace(
    /[^\x00-\x7e]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

/** Encodes with two-space indentation and ASCII-only output. */
export function encodeJson(value: Json, indent = ''): string {
  if (value === null || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'bigint' || typeof value === 'number') {
    return numberText(value);
  }
  if (typeof value === 'string') {
    return encodeString(value);
  }

  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }

    const items = value.map((item) => inner + encodeJson(item, inner));
    return `[\n${items.join(',\n')}\n${indent}]`;
  }

  if (value.size === 0) {
    return '{}';
  }

  const members = Array.from(
    value,
    ([key, member]) =>
      `${inner}${encodeString(key)}: ${encodeJson(member, inner)}`
  );
  return `{\n${members.join(',\n')}\n${indent}}`;
}
