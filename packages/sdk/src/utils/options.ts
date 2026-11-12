import { MacroError } from './unwrap';

/**
 * Throws when `options` carries a key outside `allowed`. JavaScript callers,
 * such as code-mode programs, get no type check, so a wrong key would
 * otherwise be dropped silently. `allowed` names every option of the type, so
 * the compiler flags a list that misses one.
 */
export function rejectUnknownOptions<Options extends object>(
  method: string,
  options: Options,
  allowed: Record<keyof Options, true>,
): void {
  const unknown = Object.keys(options).filter((key) => !(key in allowed));

  if (unknown.length === 0) return;

  const quote = (keys: readonly string[]) =>
    keys.map((key) => `\`${key}\``).join(', ');

  throw new MacroError(
    `${method} does not take ${quote(unknown)}; its options are ${quote(Object.keys(allowed))}.`,
  );
}
