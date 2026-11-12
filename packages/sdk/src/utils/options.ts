import { MacroError } from './unwrap';

/**
 * Throws when `options` carries a key outside `allowed`. JavaScript callers,
 * such as code-mode programs, get no type check, so a wrong key would
 * otherwise be dropped silently.
 */
export function rejectUnknownOptions<Options extends object>(
  method: string,
  options: Options,
  allowed: readonly (keyof Options & string)[],
): void {
  const known: readonly string[] = allowed;
  const unknown = Object.keys(options).filter((key) => !known.includes(key));
  if (unknown.length === 0) return;
  const quote = (keys: readonly string[]) =>
    keys.map((key) => `\`${key}\``).join(', ');
  throw new MacroError(
    `${method} does not take ${quote(unknown)}; its options are ${quote(allowed)}.`,
  );
}
