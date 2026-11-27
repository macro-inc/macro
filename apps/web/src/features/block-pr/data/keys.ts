export function prForeignEntityQueryKey(id: string): string[] {
  return ['github-pr', 'foreign-entity', id];
}

export function prMergeabilityQueryKey(id: string) {
  return ['github-pr', 'mergeability', id] as const;
}
