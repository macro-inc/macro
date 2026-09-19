const root = ['call'] as const;
const active = [...root, 'active'] as const;
const record = [...root, 'record'] as const;

export const callKeys = {
  _def: root,
  active: Object.assign(
    (channelId: string) => ({
      queryKey: [...active, channelId] as const,
    }),
    { _def: active }
  ),
  // Under the `active` prefix so one invalidation covers both. No collision
  // with per-channel keys: channel ids are UUIDs, never the literal 'all'.
  allActive: {
    queryKey: [...active, 'all'] as const,
  },
  record: Object.assign(
    (callId: string) => ({
      queryKey: [...record, callId] as const,
    }),
    { _def: record }
  ),
} as const;
