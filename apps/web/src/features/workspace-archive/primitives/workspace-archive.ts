import { match } from 'ts-pattern';
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  type ArchivedEntity,
  type ArchiveFailure,
  type ArchiveFile,
  decodeArchive,
  encodeArchive,
} from '../core/archive';
import {
  type ImportStep,
  type MarkdownKind,
  orderForExport,
  planImport,
  type WorkspaceListing,
} from '../core/plan';

/** Reads everything the signed-in user can access. */
export type WorkspaceSource = {
  list(): AsyncIterable<WorkspaceListing>;
  /** Content files for one item; an empty list when it has none. */
  content(listing: WorkspaceListing): Promise<ArchiveFile[]>;
};

/** Creates restored items in the signed-in user's workspace. */
export type WorkspaceTarget = {
  createProject(name: string, parentId: string | undefined): Promise<string>;
  createMarkdown(step: {
    kind: MarkdownKind;
    name: string;
    projectId: string | undefined;
    markdown: string;
  }): Promise<void>;
  upload(step: {
    fileName: string;
    projectId: string | undefined;
    bytes: Uint8Array;
  }): Promise<void>;
};

export type ArchiveProgress = { done: number; total: number | undefined };

/** Content requests in flight at once during an export. */
const EXPORT_CONCURRENCY = 6;
/** Creates in flight at once during an import. */
const IMPORT_CONCURRENCY = 4;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs `fn` over `items` with bounded concurrency, yielding in input order. */
async function* mapInOrder<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): AsyncGenerator<R> {
  const running: Promise<R>[] = [];
  let next = 0;
  while (next < items.length || running.length > 0) {
    while (next < items.length && running.length < limit)
      running.push(fn(items[next++]));
    const head = running.shift();
    if (head) yield await head;
  }
}

/**
 * Streams the whole workspace into an archive. Lists everything first so
 * folders can be written before their contents, then fetches content
 * concurrently. An item whose content can't be read is still archived with
 * its listing data and recorded in the summary's failures.
 */
export async function exportWorkspace(args: {
  source: WorkspaceSource;
  exportedBy: string;
  now: Date;
  onProgress: (progress: ArchiveProgress) => void;
}): Promise<ReadableStream<Uint8Array>> {
  const listings: WorkspaceListing[] = [];
  for await (const listing of args.source.list()) {
    listings.push(listing);
    args.onProgress({ done: 0, total: listings.length });
  }
  const ordered = orderForExport(listings);
  const failures: ArchiveFailure[] = [];
  let done = 0;

  async function archive(listing: WorkspaceListing): Promise<ArchivedEntity> {
    let files: ArchiveFile[] = [];
    try {
      files = await args.source.content(listing);
    } catch (error) {
      failures.push({
        kind: listing.kind,
        id: listing.id,
        reason: reason(error),
      });
    }
    args.onProgress({ done: ++done, total: ordered.length });
    return { kind: listing.kind, id: listing.id, data: listing.data, files };
  }

  return encodeArchive(
    {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      exportedAt: args.now.toISOString(),
      exportedBy: args.exportedBy,
    },
    mapInOrder(ordered, EXPORT_CONCURRENCY, archive),
    () => failures
  );
}

export type ImportReport = {
  restored: number;
  /** Archived items Macro can't recreate yet, by kind. */
  notRestorable: Record<string, number>;
  failed: ArchiveFailure[];
  /** Items the exporter itself couldn't read. */
  exportFailures: number;
};

async function runStep(
  step: ImportStep,
  target: WorkspaceTarget
): Promise<string | undefined> {
  return match(step)
    .with({ action: 'project' }, (project) =>
      target.createProject(project.name, project.parentId)
    )
    .with({ action: 'markdown' }, async (markdown) => {
      await target.createMarkdown({
        kind: markdown.kind,
        name: markdown.name,
        projectId: markdown.projectId,
        markdown: markdown.markdown,
      });
      return undefined;
    })
    .with({ action: 'upload' }, async (upload) => {
      await target.upload({
        fileName: upload.fileName,
        projectId: upload.projectId,
        bytes: upload.bytes,
      });
      return undefined;
    })
    .with({ action: 'skip' }, () => undefined)
    .exhaustive();
}

/**
 * Recreates an archive's contents. Folders are created one at a time so
 * their new ids are known before anything is placed in them; other items
 * are created concurrently. One item failing never stops the import.
 */
export async function importWorkspace(args: {
  archive: ReadableStream<Uint8Array>;
  target: WorkspaceTarget;
  onProgress: (progress: ArchiveProgress) => void;
}): Promise<ImportReport> {
  const projectIds = new Map<string, string>();
  const report: ImportReport = {
    restored: 0,
    notRestorable: {},
    failed: [],
    exportFailures: 0,
  };
  const running = new Set<Promise<void>>();
  let done = 0;

  const restore = async (entity: ArchivedEntity, step: ImportStep) => {
    try {
      const created = await runStep(step, args.target);
      if (step.action === 'project' && created)
        projectIds.set(entity.id, created);
      report.restored++;
    } catch (error) {
      report.failed.push({
        kind: entity.kind,
        id: entity.id,
        reason: reason(error),
      });
    }
    args.onProgress({ done: ++done, total: undefined });
  };

  for await (const item of decodeArchive(args.archive)) {
    if (item.type === 'summary') {
      report.exportFailures = item.summary.failures.length;
      continue;
    }
    if (item.type !== 'entity') continue;
    const { entity } = item;
    const step = planImport(entity, projectIds);
    if (step.action === 'skip') {
      if (step.reason === 'not_restorable')
        report.notRestorable[entity.kind] =
          (report.notRestorable[entity.kind] ?? 0) + 1;
      args.onProgress({ done: ++done, total: undefined });
      continue;
    }
    if (step.action === 'project') {
      await Promise.all(running);
      await restore(entity, step);
      continue;
    }
    running.add(restore(entity, step));
    if (running.size >= IMPORT_CONCURRENCY) {
      const finished = await Promise.race(
        [...running].map(async (task) => {
          await task;
          return { task };
        })
      );
      running.delete(finished.task);
    }
  }
  await Promise.all(running);
  return report;
}
