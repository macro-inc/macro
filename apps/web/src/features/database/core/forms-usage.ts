import { match } from 'ts-pattern';

/**
 * What the database knows about the forms over a table or asking a column:
 * still reading, unreadable, or their names.
 */
export type FormsUsage =
  | { kind: 'checking' }
  | { kind: 'unknown' }
  | {
      kind: 'known';
      /** Forms asking it as a question (tables: forms writing to it). */
      names: readonly string[];
      /** Forms whose gate rules test it. */
      gated: readonly string[];
    };

const quoted = (names: readonly string[]) =>
  names.map((name) => `“${name}”`).join(', ');

/** The delete-table confirmation's line about forms; never "none" while unsure. */
export function tableDeleteConsequence(usage: FormsUsage): string | undefined {
  return match(usage)
    .with({ kind: 'checking' }, () => 'Checking which forms write to it…')
    .with(
      { kind: 'unknown' },
      () =>
        'Couldn’t check which forms write to it. Any that do are deleted with it.'
    )
    .with({ kind: 'known' }, ({ names }) => {
      if (names.length === 0) return undefined;
      return names.length === 1
        ? `The form ${quoted(names)} writes to it and will be deleted with it.`
        : `The forms ${quoted(names)} write to it and will be deleted with it.`;
    })
    .exhaustive();
}

/** The delete-column confirmation's line about forms; never "none" while unsure. */
export function columnDeleteNote(usage: FormsUsage): string | undefined {
  return match(usage)
    .with({ kind: 'checking' }, () => 'Checking which forms ask it…')
    .with(
      { kind: 'unknown' },
      () => 'Couldn’t check which forms ask it. Any that do lose the question.'
    )
    .with({ kind: 'known' }, ({ names, gated }) => {
      const lines = [
        names.length > 0
          ? `Asked by ${quoted(names)}: the question leaves the form with it.`
          : undefined,
        gated.length > 0
          ? `${quoted(gated)} ${gated.length === 1 ? 'checks' : 'check'} it in a gate, so ${gated.length === 1 ? 'it stops' : 'they stop'} taking responses until the gate is fixed.`
          : undefined,
      ].filter((line) => line !== undefined);
      return lines.length > 0 ? lines.join(' ') : undefined;
    })
    .exhaustive();
}
