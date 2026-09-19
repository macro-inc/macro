export type NavDirection = 'prev' | 'next';

export type OpenTargetMessage = {
  db_id?: string | null;
  labels: Array<{ provider_label_id?: string | null }>;
};

export function isUnreadMessage(message: OpenTargetMessage): boolean {
  return message.labels.some((label) => label.provider_label_id === 'UNREAD');
}

/** Oldest, penultimate, and newest stay visible. Hide the rest when length > 3. */
export function isTruncatedMiddleMessage(
  chronologicalIndex: number,
  length: number
): boolean {
  return (
    length > 3 && chronologicalIndex > 0 && chronologicalIndex < length - 2
  );
}

export function truncatedMiddleCount(length: number): number {
  return length > 3 ? length - 3 : 0;
}
