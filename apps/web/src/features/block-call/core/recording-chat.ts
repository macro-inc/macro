export function recordingChatMessages<
  T extends {
    id: string;
    kind?: string;
    deleted_at?: string | null;
    created_at: string;
  },
>(thread: { root: T; replies: T[] } | undefined): T[] {
  if (!thread) return [];
  return [thread.root, ...thread.replies]
    .filter((message) => message.kind !== 'call_root' && !message.deleted_at)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

export function messageVideoSeconds(
  createdAt: string,
  timelineStartMs: number | null,
  durationSeconds = Infinity
): number | null {
  if (timelineStartMs === null) return null;
  const seconds = (Date.parse(createdAt) - timelineStartMs) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= durationSeconds
    ? seconds
    : null;
}
