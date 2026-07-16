import type { GroupedSoupInput } from '@service-storage/graphql/generated/graphql';

const continuationToInitial = new Map<string, string>();

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function groupedSoupInputKey(input: unknown): string {
  return canonical(input);
}

/** Associates one loaded continuation page with its initial logical view. */
export function registerGroupedSoupContinuation(
  initial: GroupedSoupInput,
  continuation: GroupedSoupInput
): void {
  continuationToInitial.set(
    groupedSoupInputKey(continuation),
    groupedSoupInputKey(initial)
  );
}

/** Returns the initial-view key for an initial or registered continuation. */
export function groupedSoupLogicalViewKey(input: unknown): string | undefined {
  if (input !== null && typeof input === 'object' && 'initial' in input) {
    return groupedSoupInputKey(input);
  }
  return continuationToInitial.get(groupedSoupInputKey(input));
}
