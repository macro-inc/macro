/**
 * The rules for storing a credential and for handing one to a program. A
 * value is made here or read from a program's output, checked, and stored;
 * it never passes through a model, and nothing here gives one back.
 */

/** Shortest value that will be stored; a generated password is 32 characters. */
export const minimumLength = 16;

const passwordBytes = 24;

/** Where randomness comes from, injected. */
export type Random = {
  readonly bytes: (count: number) => Uint8Array;
};

export const newPassword = (random: Pick<Random, 'bytes'>): string =>
  btoa(String.fromCharCode(...random.bytes(passwordBytes)));

/** A credential's name is an environment variable's: it is often handed to a program as one. */
export const checkName = (name: string): void => {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name))
    throw new Error(
      `refusing ${JSON.stringify(name)}: a name is upper case letters, digits and underscores, e.g. EXAMPLE_API_KEY`
    );
};

/**
 * The value to store under `name`, or a throw. A command that fails halfway
 * through a pipe can print nothing and still exit 0, so an empty or short
 * value is refused, and nothing is stored.
 */
export const checkSecret = (name: string, value: string): string => {
  checkName(name);
  const trimmed = value.replace(/\r?\n$/, '');
  if (/\s/.test(trimmed))
    throw new Error(`refusing ${name}: the value has whitespace in it`);
  if (trimmed.length < minimumLength)
    throw new Error(
      `refusing ${name}: ${trimmed.length > 0 ? 'shorter than' : 'empty, not even'} ${minimumLength} characters; nothing stored`
    );
  return trimmed;
};

/** What a program printed, when it is to be stored: a program that prints a string as JSON means the string inside. */
export const printedValue = (stdout: string): string => {
  const text = stdout.trim();
  if (!text.startsWith('"')) return text;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'string' ? parsed : text;
  } catch {
    return text;
  }
};

const redacted = '[redacted]';

/** `text` with every one of `secrets` cut out, so a program that echoes what it was given doesn't hand it to the model. */
export const redact = (text: string, secrets: readonly string[]): string =>
  secrets
    .filter((secret) => secret !== '')
    .reduce((clean, secret) => clean.replaceAll(secret, redacted), text);
