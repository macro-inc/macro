import type {
  ImportEntity,
  ImportEntityStatus,
  ImportRun,
  ImportSource,
  ImportState,
} from '@service-cognition/import';
import { match } from 'ts-pattern';

/** One discovered item, as the native import list shows it. */
export type ImportItem = {
  id: string;
  title: string;
  /** A secondary line: a Linear identifier and status, a Notion summary. */
  detail?: string;
  status: Exclude<ImportEntityStatus, 'discarded'>;
  /** The created Macro entity, once imported. */
  entity?: { id: string; type: string };
  error?: string;
};

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function toImportItem(entity: ImportEntity): ImportItem | undefined {
  if (entity.status === 'discarded') return undefined;
  const meta = entity.metadata;
  const title =
    entity.source === 'slack'
      ? `#${text(meta.name)?.replace(/^#/, '') ?? entity.foreign_id}`
      : (text(meta.title) ?? text(meta.name) ?? entity.foreign_id);
  const detail = match(entity.source)
    .with('linear', () =>
      [text(meta.identifier), text(meta.status)].filter(Boolean).join(' · ')
    )
    .with('notion', () => text(meta.summary))
    .with('slack', () =>
      [
        meta.archived === true ? 'Archived' : undefined,
        text(meta.purpose),
        typeof meta.member_count === 'number'
          ? `${meta.member_count} members`
          : undefined,
      ]
        .filter(Boolean)
        .join(' · ')
    )
    .exhaustive();
  return {
    id: entity.id,
    title,
    detail: detail || undefined,
    status: entity.status,
    entity:
      entity.entity_id && entity.entity_type
        ? { id: entity.entity_id, type: entity.entity_type }
        : undefined,
    error: entity.last_error ?? undefined,
  };
}

const STATUS_ORDER: Record<ImportItem['status'], number> = {
  staged: 0,
  importing: 1,
  imported: 2,
};

/** One source's items: staged first (selectable), then in-flight and done. */
export function importItems(
  state: ImportState,
  source: ImportSource
): ImportItem[] {
  return state.entities
    .filter((entity) => entity.source === source)
    .flatMap((entity) => toImportItem(entity) ?? [])
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

export function importRun(
  state: ImportState,
  source: ImportSource
): ImportRun | undefined {
  return state.runs.find((run) => run.source === source);
}

/** Whether opening a source should start finding items to import. */
export function needsDiscovery(
  run: ImportRun | undefined,
  items: readonly ImportItem[]
): boolean {
  if (run?.status === 'running' || run?.status === 'importing') return false;
  return !items.some((item) => item.status === 'staged');
}
