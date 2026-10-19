export type NavDirection = 'prev' | 'next';

export type OpenTargetMessage = {
  db_id?: string | null;
  is_read: boolean;
};

export function isUnreadMessage(message: OpenTargetMessage): boolean {
  return !message.is_read;
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
