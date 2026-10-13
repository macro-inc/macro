/**
 * Why a live one-on-one is not recording or transcribing, or `null` when
 * nobody in it refuses. The viewer is called "you"; everyone else is named.
 */
export function recordingRefusalNotice(
  refusedBy: readonly string[],
  viewerId: string | undefined,
  nameOf: (userId: string) => string
): string | null {
  if (refusedBy.length === 0) return null;
  const others = refusedBy.filter((id) => id !== viewerId).map(nameOf);
  const people =
    viewerId && refusedBy.includes(viewerId) ? ['you', ...others] : others;
  const verb = people.length === 1 && people[0] !== 'you' ? "doesn't" : "don't";
  return `Not recording or transcribing: ${people.join(' and ')} ${verb} allow 1:1 recordings`;
}
