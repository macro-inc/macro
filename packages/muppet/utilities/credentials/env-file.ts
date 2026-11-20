import type { Credentials } from './index.ts';

/** An env file's values, or the first line that isn't `KEY=value`. A value never appears in `reason`. */
export type ParsedEnvFile =
  | {
      readonly kind: 'parsed';
      readonly values: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: 'malformed';
      readonly line: number;
      readonly reason: string;
    };

const name = /^[A-Za-z_][A-Za-z0-9_]*$/;

type Value =
  | { readonly kind: 'value'; readonly value: string }
  | { readonly kind: 'malformed'; readonly reason: string };

/** A double-quoted value as systemd writes it: `\\` and `\"` are the only escapes. */
const unquoted = (raw: string): Value => {
  let value = '';
  for (let index = 1; index < raw.length; index++) {
    const character = raw[index];
    if (character === '"')
      return index === raw.length - 1
        ? { kind: 'value', value }
        : { kind: 'malformed', reason: 'text after the closing quote' };
    if (character === '\\') {
      const escaped = raw[index + 1];
      if (escaped !== '\\' && escaped !== '"')
        return {
          kind: 'malformed',
          reason: 'an escape other than \\\\ or \\"',
        };
      value += escaped;
      index++;
    } else value += character;
  }
  return { kind: 'malformed', reason: 'an unclosed quote' };
};

/**
 * The values of an environment file: `KEY=value` lines, as enrollment writes
 * an agent's `agent.env`. Blank lines and `#` comments are skipped. A value is
 * taken as it is, or unquoted when it is in double quotes. A malformed line
 * is reported by its number alone, since the line may hold a secret.
 */
export const parseEnvFile = (text: string): ParsedEnvFile => {
  const values: Record<string, string> = {};
  const lines = text.split('\n');
  for (const [index, raw] of lines.entries()) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const number = index + 1;
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals === -1)
      return { kind: 'malformed', line: number, reason: 'expected KEY=value' };
    const key = line.slice(0, equals);
    if (!name.test(key))
      return {
        kind: 'malformed',
        line: number,
        reason:
          'a name must be letters, digits and _, not starting with a digit',
      };
    if (key in values)
      return { kind: 'malformed', line: number, reason: `${key} is set twice` };
    const rest = line.slice(equals + 1);
    const value: Value = rest.startsWith('"')
      ? unquoted(rest)
      : { kind: 'value', value: rest };
    if (value.kind === 'malformed')
      return { kind: 'malformed', line: number, reason: value.reason };
    values[key] = value.value;
  }
  return { kind: 'parsed', values };
};

/**
 * Credentials from an environment file the agent is given, e.g. a hosted
 * agent's enrollment, read once as it starts. They are only read: whoever
 * wrote the file owns them, so `set` refuses.
 */
export const envFileCredentials = ({
  file,
  values,
}: {
  /** Where the values came from, for errors. */
  readonly file: string;
  readonly values: Readonly<Record<string, string>>;
}): Credentials => ({
  get: async (key) => {
    const value = values[key];
    if (value === undefined || value === '')
      throw new Error(`no credential named ${key} in ${file}`);
    return value;
  },
  has: async (key) => (values[key] ?? '') !== '',
  set: async (key) => {
    throw new Error(
      `${key} can't be stored: this agent's credentials come from its enrollment (${file})`
    );
  },
  names: async () => Object.keys(values).sort(),
});

const withheld = 'credentials stay with the agent';

/**
 * Credentials as a script sees them when it runs in a process of its own:
 * their names, and no values. The agent's process keeps every value, and
 * reaches Macro for the script through its relay.
 */
export const withheldCredentials = (names: readonly string[]): Credentials => ({
  get: async (key) => {
    throw new Error(`${key} can't be read here: ${withheld}`);
  },
  has: async (key) => names.includes(key),
  set: async (key) => {
    throw new Error(`${key} can't be stored here: ${withheld}`);
  },
  names: async () => [...names].sort(),
});
