/** Website fixture contracts. These do not import the authenticated import service. */
export type ImportSource = 'linear' | 'notion' | 'slack';

export interface ImportRun {
  source: ImportSource;
  status:
    | 'running'
    | 'ready'
    | 'importing'
    | 'completed'
    | 'failed'
    | 'dismissed';
  auto_import: boolean;
  updated_at: string;
}

export interface ImportEntity {
  id: string;
  source: ImportSource;
  status: 'staged' | 'importing' | 'imported' | 'discarded';
  metadata: Record<string, unknown>;
  /** Optional website-owned destination, never a live workspace mutation. */
  href?: string;
}

export function entityLabel(entity: ImportEntity): string {
  const field = entity.source === 'slack' ? 'name' : 'title';
  const value = entity.metadata[field];
  return typeof value === 'string' && value.length > 0 ? value : '(unnamed)';
}
