export interface ExportFact {
  readonly kind: string;
  readonly arity?: number;
}
export interface NamespaceFacts {
  readonly status: 'evaluated' | 'blocked';
  readonly exports: ReadonlyMap<string, ExportFact>;
  readonly error?: string;
}

export function compareRuntime(
  expected: NamespaceFacts,
  actual: NamespaceFacts
) {
  const missing: string[] = [];
  const extra: string[] = [];
  const mismatches: {
    name: string;
    expected: ExportFact;
    actual: ExportFact;
  }[] = [];
  if (expected.status !== 'evaluated' || actual.status !== 'evaluated')
    return {
      status: 'blocked',
      missing,
      extra,
      mismatches,
      expectedError: expected.error,
      actualError: actual.error,
    };
  for (const [name, fact] of expected.exports) {
    const found = actual.exports.get(name);
    if (!found) missing.push(name);
    else if (
      found.kind !== fact.kind ||
      (fact.arity !== undefined &&
        found.arity !== undefined &&
        fact.arity !== found.arity)
    )
      mismatches.push({ name, expected: fact, actual: found });
  }
  for (const name of actual.exports.keys())
    if (!expected.exports.has(name)) extra.push(name);
  return {
    status:
      missing.length || extra.length || mismatches.length
        ? 'mismatch'
        : 'match',
    missing: missing.sort(),
    extra: extra.sort(),
    mismatches,
  };
}

export function compareDeclarationNames(
  expected: readonly string[],
  actual: readonly string[]
) {
  const wanted = new Set(expected);
  const found = new Set(actual);
  return {
    missing: [...wanted].filter((name) => !found.has(name)).sort(),
    extra: [...found].filter((name) => !wanted.has(name)).sort(),
  };
}
