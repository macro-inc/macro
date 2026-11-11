import type { ExportFact, NamespaceFacts } from './surface';

function exportFact(value: unknown): ExportFact {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('kind' in value) ||
    typeof value.kind !== 'string'
  )
    throw new Error('Invalid runtime export fact');
  const arity = 'arity' in value ? value.arity : undefined;
  if (
    arity !== undefined &&
    (typeof arity !== 'number' || !Number.isInteger(arity) || arity < 0)
  )
    throw new Error('Invalid runtime function arity');
  return { kind: value.kind, arity };
}

export function parseProbe(
  output: string,
  exitCode: number | null,
  diagnostic: string
): NamespaceFacts {
  const line = output
    .split('\n')
    .findLast((value) => value.startsWith('LEXICAL_SURFACE='));
  if (!line)
    return {
      status: 'blocked',
      exports: new Map(),
      error: diagnostic || 'Namespace probe omitted its result',
    };
  const parsed: unknown = JSON.parse(line.slice('LEXICAL_SURFACE='.length));
  if (parsed === null || typeof parsed !== 'object' || !('status' in parsed))
    throw new Error('Malformed namespace probe');
  if (parsed.status !== 'evaluated' || exitCode !== 0)
    return {
      status: 'blocked',
      exports: new Map(),
      error:
        'error' in parsed && typeof parsed.error === 'string'
          ? parsed.error
          : 'Namespace probe failed',
    };
  if (
    !('exports' in parsed) ||
    parsed.exports === null ||
    typeof parsed.exports !== 'object'
  )
    throw new Error('Namespace probe omitted exports');
  return {
    status: 'evaluated',
    exports: new Map(
      Object.entries(parsed.exports).map(([name, value]) => [
        name,
        exportFact(value),
      ])
    ),
  };
}
