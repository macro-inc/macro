import { describe, expect, it } from 'vitest';
import { FILES, type WorkspaceListing } from '../core/plan';
import {
  exportWorkspace,
  importWorkspace,
  type WorkspaceSource,
  type WorkspaceTarget,
} from './workspace-archive';

const bytes = (text: string) => new TextEncoder().encode(text);

const LISTINGS: WorkspaceListing[] = [
  {
    kind: 'document',
    id: 'doc',
    data: { name: 'Notes', fileType: 'md', projectId: 'inner' },
  },
  {
    kind: 'project',
    id: 'inner',
    data: { name: 'Inner', parentId: 'outer' },
  },
  {
    kind: 'document',
    id: 'pdf',
    data: { name: 'Scan', fileType: 'pdf', projectId: 'outer' },
  },
  { kind: 'project', id: 'outer', data: { name: 'Outer', parentId: null } },
  {
    kind: 'document',
    id: 'task',
    data: { name: 'Ship', fileType: 'md', subType: { type: 'task' } },
  },
  { kind: 'emailThread', id: 'mail', data: { subject: 'Hi' } },
  { kind: 'document', id: 'broken', data: { name: 'Gone', fileType: 'pdf' } },
];

const CONTENT: Record<string, { name: string; bytes: Uint8Array }[]> = {
  doc: [
    { name: FILES.markdown, bytes: bytes('# Notes') },
    { name: FILES.collab, bytes: bytes('loro') },
  ],
  pdf: [{ name: FILES.original, bytes: bytes('%PDF-1.7') }],
  task: [{ name: FILES.markdown, bytes: bytes('- [ ] ship') }],
  mail: [{ name: FILES.emailThread, bytes: bytes('{"messages":[]}') }],
};

const source: WorkspaceSource = {
  async *list() {
    yield* LISTINGS;
  },
  async content(listing) {
    if (listing.id === 'broken') throw new Error('content unavailable');
    return CONTENT[listing.id] ?? [];
  },
};

function recordingTarget() {
  const calls: unknown[] = [];
  let projects = 0;
  const target: WorkspaceTarget = {
    async createProject(name, parentId) {
      const id = `new-${++projects}`;
      calls.push({ project: name, parentId, id });
      return id;
    },
    async createMarkdown(step) {
      calls.push({ markdown: step });
    },
    async upload(step) {
      calls.push({
        upload: step.fileName,
        projectId: step.projectId,
        text: new TextDecoder().decode(step.bytes),
      });
    },
  };
  return { calls, target };
}

describe('workspace export and import', () => {
  it('rebuilds folders, documents, tasks and files from an export', async () => {
    const archive = await exportWorkspace({
      source,
      exportedBy: 'user-1',
      now: new Date('2026-11-02T00:00:00Z'),
      onProgress: () => {},
    });
    const { calls, target } = recordingTarget();
    const report = await importWorkspace({
      archive,
      target,
      onProgress: () => {},
    });

    expect(calls.slice(0, 2)).toEqual([
      { project: 'Outer', parentId: undefined, id: 'new-1' },
      { project: 'Inner', parentId: 'new-1', id: 'new-2' },
    ]);
    expect(calls.slice(2)).toEqual(
      expect.arrayContaining([
        {
          markdown: {
            kind: 'note',
            name: 'Notes',
            projectId: 'new-2',
            markdown: '# Notes',
          },
        },
        { upload: 'Scan.pdf', projectId: 'new-1', text: '%PDF-1.7' },
        {
          markdown: {
            kind: 'task',
            name: 'Ship',
            projectId: undefined,
            markdown: '- [ ] ship',
          },
        },
      ])
    );
    expect(calls).toHaveLength(5);
    expect(report).toEqual({
      restored: 5,
      notRestorable: { emailThread: 1 },
      failed: [],
      exportFailures: 1,
    });
  });

  it('keeps importing when one item fails to restore', async () => {
    const archive = await exportWorkspace({
      source,
      exportedBy: 'user-1',
      now: new Date('2026-11-02T00:00:00Z'),
      onProgress: () => {},
    });
    const { target } = recordingTarget();
    const report = await importWorkspace({
      archive,
      target: {
        ...target,
        async upload() {
          throw new Error('quota exceeded');
        },
      },
      onProgress: () => {},
    });
    expect(report.restored).toBe(4);
    expect(report.failed).toEqual([
      { kind: 'document', id: 'pdf', reason: 'quota exceeded' },
    ]);
  });
});
