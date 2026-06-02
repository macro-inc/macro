const root = ['call'] as const;
const active = [...root, 'active'] as const;
const activeChannels = [...active, 'channels'] as const;
const record = [...root, 'record'] as const;

export const callKeys = {
  _def: root,
  active: Object.assign(
    (channelId: string) => ({
      queryKey: [...active, channelId] as const,
    }),
    { _def: active }
  ),
  activeChannels: Object.assign(
    (channelIds: string[]) => ({
      queryKey: [...activeChannels, channelIds] as const,
    }),
    { _def: activeChannels }
  ),
  record: Object.assign(
    (callId: string) => ({
      queryKey: [...record, callId] as const,
    }),
    { _def: record }
  ),
} as const;
