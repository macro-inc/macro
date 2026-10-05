export const WORKSPACE_ACCENTS = [
  { name: 'Pearl', color: '#e8e2db' },
  { name: 'Lilac', color: '#b8a1ed' },
  { name: 'Coral', color: '#f77d67' },
  { name: 'Amber', color: '#f4c65c' },
  { name: 'Mint', color: '#65d8ac' },
  { name: 'Sky', color: '#7abde5' },
] as const;

export type WorkspaceAccent = (typeof WORKSPACE_ACCENTS)[number];

const DEFAULT_WORKSPACE_ACCENT: WorkspaceAccent = WORKSPACE_ACCENTS[4];

export const workspaceAccentNamed = (name: string): WorkspaceAccent =>
  WORKSPACE_ACCENTS.find((accent) => accent.name === name) ??
  DEFAULT_WORKSPACE_ACCENT;
