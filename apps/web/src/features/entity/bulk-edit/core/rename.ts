import { match } from 'ts-pattern';

export type RenameMode = 'total' | 'prepend' | 'append' | 'replace';

export function renamedEntityName(
  name: string,
  mode: RenameMode,
  value: string,
  find: string,
  replacement: string
): string {
  return match(mode)
    .with('total', () => value)
    .with('prepend', () => value + name)
    .with('append', () => name + value)
    .with('replace', () => name.replaceAll(find, replacement))
    .exhaustive();
}
