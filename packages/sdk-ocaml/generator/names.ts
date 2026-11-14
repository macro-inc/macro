/** OCaml names and literals. */

export const KEYWORDS = new Set(
  `and as assert asr begin class constraint do done downto effect else end
  exception external false for fun function functor if in include inherit
  initializer land lazy let lor lsl lsr lxor match method mod module mutable
  new nonrec object of open or private rec sig struct then to true try type
  val virtual when while with`.split(/\s+/)
);

/** Type names `Types` must not shadow. */
export const RESERVED_TYPES = new Set([
  ...KEYWORDS,
  'array',
  'bool',
  'bytes',
  'char',
  'exn',
  'float',
  'format',
  'int',
  'int32',
  'int64',
  'lazy_t',
  'list',
  'option',
  'ref',
  'result',
  'seq',
  'string',
  't',
  'unit',
  'json',
]);

export function snake(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

/** A lowercase OCaml identifier (value, label, field, type). */
export function ident(name: string) {
  let out = snake(name) || 'x';
  if (/^[0-9]/.test(out)) out = `n_${out}`;
  return KEYWORDS.has(out) ? `${out}_` : out;
}

export function capitalize(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function moduleName(name: string) {
  const out = snake(name) || 'X';
  return capitalize(/^[0-9]/.test(out) ? `m_${out}` : out);
}

export type Literal = string | number | boolean | null;

export function tagOf(value: Literal) {
  if (value === null) return 'Null';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number')
    return `N${String(value).replace('-', 'neg').replace('.', '_')}`;
  const out = snake(value);
  if (!out) return 'Empty';
  return capitalize(/^[0-9]/.test(out) ? `v_${out}` : out);
}

export function unique(base: string, taken: Set<string>) {
  let name = base;
  for (let suffix = 2; taken.has(name); suffix++) name = `${base}_${suffix}`;
  taken.add(name);
  return name;
}

export function ocamlString(value: string) {
  let out = '"';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === '"') out += '\\"';
    else if (char === '\\') out += '\\\\';
    else if (char === '\n') out += '\\n';
    else if (char === '\r') out += '\\r';
    else if (char === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f)
      out += `\\x${code.toString(16).padStart(2, '0')}`;
    else out += char;
  }
  return `${out}"`;
}

export function ocamlFloat(value: number) {
  const text = Number.isInteger(value) ? `${value}.` : String(value);
  return value < 0 ? `(${text})` : text;
}

export function ocamlInt(value: number) {
  return value < 0 ? `(${value})` : String(value);
}

/** Text safe inside an OCaml doc comment. */
function commentText(text: string) {
  return text
    .replace(/"/g, "'")
    .replace(/\{([a-z_]*)\|/g, '{ $1|')
    .replace(/\(\*/g, '( *')
    .replace(/\*\)/g, '* )')
    .trim();
}

export function docComment(text: string, indent: string) {
  const body = commentText(text);
  if (!body) return '';
  const lines = body
    .split('\n')
    .map((line) => line.trimEnd())
    .map((line, index) => (index && line ? `${indent}    ${line}` : line));
  return `${indent}(** ${lines.join('\n')} *)\n`;
}

/** RFC 3986 percent-encoding of everything but the unreserved characters. */
export function percentEncode(text: string) {
  let out = '';
  for (const byte of new TextEncoder().encode(text)) {
    const char = String.fromCharCode(byte);
    out += /[A-Za-z0-9\-._~]/.test(char)
      ? char
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}
