import { describe, expect, it } from 'vitest';
import { FILES, orderForExport, planImport } from './plan';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('orderForExport', () => {
  it('puts every folder after its parent and before other items', () => {
    const ordered = orderForExport([
      { kind: 'document', id: 'd1', data: {} },
      { kind: 'project', id: 'child', data: { parentId: 'parent' } },
      { kind: 'project', id: 'grandchild', data: { parentId: 'child' } },
      { kind: 'emailThread', id: 'e1', data: {} },
      { kind: 'project', id: 'parent', data: { parentId: null } },
      { kind: 'document', id: 'd1', data: {} },
    ]);
    expect(ordered.map((item) => item.id)).toEqual([
      'parent',
      'child',
      'grandchild',
      'd1',
      'e1',
    ]);
  });

  it('terminates on a parent cycle', () => {
    const ordered = orderForExport([
      { kind: 'project', id: 'a', data: { parentId: 'b' } },
      { kind: 'project', id: 'b', data: { parentId: 'a' } },
    ]);
    expect(ordered.map((item) => item.id).sort()).toEqual(['a', 'b']);
  });
});

describe('planImport', () => {
  const projects = new Map([['old-folder', 'new-folder']]);

  it('recreates folders under their recreated parent', () => {
    expect(
      planImport(
        {
          kind: 'project',
          id: 'p',
          data: { name: 'Specs', parentId: 'old-folder' },
          files: [],
        },
        projects
      )
    ).toEqual({ action: 'project', name: 'Specs', parentId: 'new-folder' });
  });

  it('recreates tasks, snippets and skills as their own kind', () => {
    for (const type of ['task', 'snippet', 'skill'] as const) {
      expect(
        planImport(
          {
            kind: 'document',
            id: 'd',
            data: {
              name: 'Ship it',
              fileType: 'md',
              subType: { type },
              projectId: 'old-folder',
            },
            files: [{ name: FILES.markdown, bytes: bytes('# Ship') }],
          },
          projects
        )
      ).toEqual({
        action: 'markdown',
        kind: type,
        name: 'Ship it',
        projectId: 'new-folder',
        markdown: '# Ship',
      });
    }
  });

  it('uploads files and canvases with their extension', () => {
    expect(
      planImport(
        {
          kind: 'document',
          id: 'd',
          data: { name: 'Q3/plan', fileType: 'pdf', projectId: 'gone' },
          files: [{ name: FILES.original, bytes: bytes('%PDF') }],
        },
        projects
      )
    ).toEqual({
      action: 'upload',
      fileName: 'Q3-plan.pdf',
      projectId: undefined,
      bytes: bytes('%PDF'),
    });
    expect(
      planImport(
        {
          kind: 'document',
          id: 'c',
          data: { name: 'Board.canvas', fileType: 'canvas' },
          files: [{ name: FILES.canvas, bytes: bytes('{}') }],
        },
        projects
      )
    ).toMatchObject({ action: 'upload', fileName: 'Board.canvas' });
  });

  it('skips deleted items, content-less documents and synced kinds', () => {
    expect(
      planImport(
        {
          kind: 'document',
          id: 'd',
          data: { fileType: 'md', deletedAt: '2026-01-01T00:00:00Z' },
          files: [],
        },
        projects
      )
    ).toEqual({ action: 'skip', reason: 'deleted' });
    expect(
      planImport(
        { kind: 'document', id: 'd', data: { fileType: 'md' }, files: [] },
        projects
      )
    ).toEqual({ action: 'skip', reason: 'no_content' });
    expect(
      planImport(
        { kind: 'emailThread', id: 'e', data: {}, files: [] },
        projects
      )
    ).toEqual({ action: 'skip', reason: 'not_restorable' });
  });
});
