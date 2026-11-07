export const passwordKeys = {
  items: (teamId: string) => ['passwords', teamId, 'items'] as const,
  folders: (teamId: string) => ['passwords', teamId, 'folders'] as const,
};
