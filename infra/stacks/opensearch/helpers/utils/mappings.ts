import type { Client } from '@opensearch-project/opensearch';

/** Compare declared mapping parameters, allowing OpenSearch's omitted defaults. */
export function mappingDifferences(
  expected: unknown,
  actual: unknown,
  path = 'mappings'
): string[] {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) {
      return [path];
    }
    return expected.flatMap((value, index) =>
      mappingDifferences(value, actual[index], `${path}.${index}`)
    );
  }
  if (expected !== null && typeof expected === 'object') {
    const record =
      actual !== null && typeof actual === 'object' && !Array.isArray(actual)
        ? (actual as Record<string, unknown>)
        : {};
    return Object.entries(expected).flatMap(([key, value]) => {
      const live = record[key];
      if (
        live === undefined &&
        value === true &&
        (key === 'index' || key === 'doc_values')
      ) {
        return [];
      }
      // The API accepts/returns dynamic as either a boolean or its string form.
      if (key === 'dynamic' && String(value) === String(live)) return [];
      return mappingDifferences(value, live, `${path}.${key}`);
    });
  }
  return expected === actual ? [] : [path];
}

export async function verifyIndexMapping(
  search: Client,
  index: string,
  expected: unknown
) {
  const response = await search.indices.getMapping({ index });
  const differences = mappingDifferences(
    expected,
    response.body[index]?.mappings
  );
  if (differences.length > 0) {
    throw new Error(
      `${index}: incompatible mapping: ${differences.join(', ')}`
    );
  }
}
