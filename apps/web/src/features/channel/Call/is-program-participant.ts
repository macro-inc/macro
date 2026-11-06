export function isProgramParticipant(
  attributes: Record<string, string> | undefined
): boolean {
  return Boolean(attributes?.['macro.program']);
}
