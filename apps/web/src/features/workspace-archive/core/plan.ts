import { match } from 'ts-pattern';
import type { ArchivedEntity, ArchiveFile } from './archive';

/** One accessible item, as the workspace listing returns it. */
export type WorkspaceListing = {
  /** The listing's own tag (`document`, `project`, `emailThread`, ...). */
  kind: string;
  id: string;
  /** Verbatim listing data, stored in the archive unchanged. */
  data: unknown;
};

/** File names inside an archived entity. */
export const FILES = {
  markdown: 'content.md',
  collab: 'collab.loro',
  canvas: 'content.canvas',
  original: 'original',
  messages: 'messages.json',
  chat: 'chat.json',
  emailThread: 'thread.json',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parentOf(listing: WorkspaceListing): string | undefined {
  return isRecord(listing.data) ? text(listing.data.parentId) : undefined;
}

/**
 * Folders first, each after its parent, then everything else in listing
 * order, so an import can create every folder before what goes in it.
 */
export function orderForExport(
  listings: WorkspaceListing[]
): WorkspaceListing[] {
  const projects = listings.filter((listing) => listing.kind === 'project');
  const byId = new Map(projects.map((project) => [project.id, project]));
  const ordered: WorkspaceListing[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();
  const place = (project: WorkspaceListing) => {
    if (placed.has(project.id) || visiting.has(project.id)) return;
    visiting.add(project.id);
    const parent = parentOf(project);
    const parentProject = parent ? byId.get(parent) : undefined;
    if (parentProject) place(parentProject);
    visiting.delete(project.id);
    placed.add(project.id);
    ordered.push(project);
  };
  for (const project of projects) place(project);
  const seen = new Set<string>();
  for (const listing of listings) {
    const key = `${listing.kind}/${listing.id}`;
    if (listing.kind === 'project' || seen.has(key)) continue;
    seen.add(key);
    ordered.push(listing);
  }
  return ordered;
}

export type MarkdownKind = 'note' | 'task' | 'snippet' | 'skill';

/** What an import does with one archived entity. */
export type ImportStep =
  | { action: 'project'; name: string; parentId: string | undefined }
  | {
      action: 'markdown';
      kind: MarkdownKind;
      name: string;
      projectId: string | undefined;
      markdown: string;
    }
  | {
      action: 'upload';
      fileName: string;
      projectId: string | undefined;
      bytes: Uint8Array;
    }
  | { action: 'skip'; reason: 'deleted' | 'not_restorable' | 'no_content' };

const decoder = new TextDecoder();

function file(entity: ArchivedEntity, name: string): ArchiveFile | undefined {
  return entity.files.find((candidate) => candidate.name === name);
}

function markdownKind(subType: unknown): MarkdownKind | undefined {
  const type = isRecord(subType) ? subType.type : undefined;
  if (type === undefined || type === null) return 'note';
  return match(type)
    .with('task', () => 'task' as const)
    .with('snippet', () => 'snippet' as const)
    .with('skill', () => 'skill' as const)
    .otherwise(() => undefined);
}

/** A name safe to upload with the document's original extension. */
function uploadName(name: string, fileType: string): string {
  const base = name.replace(/[\\/]/g, '-').trim() || 'Untitled';
  const extension = `.${fileType}`;
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`;
}

/**
 * Decides how to recreate an archived entity. `projectIds` maps archived
 * folder ids to the folders this import created; a folder that wasn't
 * recreated leaves its contents at the top level.
 */
export function planImport(
  entity: ArchivedEntity,
  projectIds: ReadonlyMap<string, string>
): ImportStep {
  const data = isRecord(entity.data) ? entity.data : {};
  if (text(data.deletedAt)) return { action: 'skip', reason: 'deleted' };
  const name = text(data.name) ?? 'Untitled';

  if (entity.kind === 'project') {
    const parent = text(data.parentId);
    return {
      action: 'project',
      name,
      parentId: parent ? projectIds.get(parent) : undefined,
    };
  }
  if (entity.kind !== 'document')
    return { action: 'skip', reason: 'not_restorable' };

  const archivedProject = text(data.projectId);
  const projectId = archivedProject
    ? projectIds.get(archivedProject)
    : undefined;
  const fileType = text(data.fileType);

  if (fileType === 'md') {
    const kind = markdownKind(data.subType);
    if (!kind) return { action: 'skip', reason: 'not_restorable' };
    const markdown = file(entity, FILES.markdown);
    if (!markdown) return { action: 'skip', reason: 'no_content' };
    return {
      action: 'markdown',
      kind,
      name,
      projectId,
      markdown: decoder.decode(markdown.bytes),
    };
  }
  if (fileType === 'canvas') {
    const canvas = file(entity, FILES.canvas);
    if (!canvas) return { action: 'skip', reason: 'no_content' };
    return {
      action: 'upload',
      fileName: uploadName(name, 'canvas'),
      projectId,
      bytes: canvas.bytes,
    };
  }
  const original = file(entity, FILES.original);
  if (!original || !fileType) return { action: 'skip', reason: 'no_content' };
  return {
    action: 'upload',
    fileName: uploadName(name, fileType),
    projectId,
    bytes: original.bytes,
  };
}
