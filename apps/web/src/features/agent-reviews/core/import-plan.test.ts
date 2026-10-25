import { describe, expect, it } from 'vitest';
import {
  alreadyInMacroSummary,
  buildPlanTree,
  EMPTY_IMPORT_DRAFT,
  type ImportPlanEntry,
  type ImportProgress,
  importCount,
  importReviewPhase,
  importVolume,
  initiallyCollapsed,
  isShared,
  planCounts,
  planningStatus,
  planSummary,
  planTotals,
  planTreeEntries,
  setExcluded,
  setShared,
  sharingSummary,
  visiblePlanNodes,
  volumeLabel,
} from './import-plan';

const unshared = {
  sampleTitles: [],
  taskFields: null,
  shared: false,
  sharedReason: null,
  shareable: false,
  alreadyImported: null,
};

const entries: ImportPlanEntry[] = [
  {
    id: 'wiki',
    parentId: null,
    kind: 'page',
    title: 'Wiki',
    decision: 'copy',
    reason: null,
    rows: null,
    status: 'staged',
    error: null,
    ...unshared,
  },
  {
    id: 'roadmap',
    parentId: 'wiki',
    kind: 'database',
    title: 'Roadmap',
    decision: 'tasks',
    reason: 'Rows have a status and an owner',
    rows: 40,
    status: 'staged',
    error: null,
    ...unshared,
  },
  {
    id: 'q3',
    parentId: 'roadmap',
    kind: 'page',
    title: 'Q3',
    decision: 'copy',
    reason: null,
    rows: null,
    status: 'staged',
    error: null,
    ...unshared,
  },
  {
    id: 'scratch',
    parentId: 'wiki',
    kind: 'page',
    title: 'Scratch',
    decision: 'skip',
    reason: 'Empty page',
    rows: null,
    status: 'staged',
    error: null,
    ...unshared,
  },
  {
    id: 'billing',
    parentId: 'gone',
    kind: 'page',
    title: 'Billing',
    decision: 'hand',
    reason: 'Holds credentials',
    rows: null,
    status: 'staged',
    error: null,
    ...unshared,
  },
];

describe('buildPlanTree', () => {
  it('orders entries depth-first and treats a missing parent as a root', () => {
    const nodes = buildPlanTree(entries);
    expect(nodes.map((node) => [node.id, node.depth, node.childIds])).toEqual([
      ['wiki', 0, ['roadmap', 'scratch']],
      ['roadmap', 1, ['q3']],
      ['q3', 2, []],
      ['scratch', 1, []],
      ['billing', 0, []],
    ]);
  });

  it('places every entry of a parent cycle exactly once', () => {
    const nodes = buildPlanTree([
      { ...entries[0], id: 'a', parentId: 'b' },
      { ...entries[0], id: 'b', parentId: 'a' },
    ]);
    expect(nodes.map((node) => [node.id, node.depth])).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });
});

describe('visiblePlanNodes', () => {
  it('hides everything under a collapsed node', () => {
    const nodes = buildPlanTree(entries);
    expect(
      visiblePlanNodes(nodes, new Set(['wiki'])).map((node) => node.id)
    ).toEqual(['wiki', 'billing']);
    expect(
      visiblePlanNodes(nodes, initiallyCollapsed(nodes)).map((node) => node.id)
    ).toEqual(['wiki', 'roadmap', 'scratch', 'billing']);
  });
});

describe('setExcluded', () => {
  it('leaves out the written objects below a node and brings them back', () => {
    const nodes = buildPlanTree(entries);
    const out = setExcluded(EMPTY_IMPORT_DRAFT, nodes, 'wiki', true);
    expect(out).toEqual({
      ...EMPTY_IMPORT_DRAFT,
      excluded: ['wiki', 'roadmap', 'q3'],
    });
    expect(importCount(entries, out.excluded)).toBe(0);
    const back = setExcluded(out, nodes, 'roadmap', false);
    expect(back).toEqual({ ...EMPTY_IMPORT_DRAFT, excluded: ['wiki'] });
    expect(importCount(entries, back.excluded)).toBe(2);
  });
});

describe('setShared', () => {
  const sharing = entries.map(
    (entry): ImportPlanEntry =>
      entry.kind === 'page'
        ? { ...entry, shared: true, shareable: true }
        : {
            ...entry,
            sharedReason: 'Personal notes',
          }
  );

  it('records only the choices that differ from the plan', () => {
    const nodes = buildPlanTree(sharing);
    const personal = setShared(EMPTY_IMPORT_DRAFT, nodes, 'wiki', false);
    // Roadmap is not shareable and Scratch is never written.
    expect(personal).toEqual({
      ...EMPTY_IMPORT_DRAFT,
      personal: ['wiki', 'q3'],
    });
    expect(nodes.map((node) => [node.id, isShared(node, personal)])).toEqual([
      ['wiki', false],
      ['roadmap', false],
      ['q3', false],
      ['scratch', true],
      ['billing', true],
    ]);
    expect(sharingSummary(sharing, personal, true)).toBe('3 only you');
    const back = setShared(personal, nodes, 'q3', true);
    expect(back).toEqual({ ...EMPTY_IMPORT_DRAFT, personal: ['wiki'] });
    expect(sharingSummary(sharing, back, true)).toBe(
      '1 shared with your team · 2 only you'
    );
    expect(setShared(back, nodes, 'wiki', true)).toEqual(EMPTY_IMPORT_DRAFT);
  });

  it('switches private rows to the team and leaves out excluded rows', () => {
    const shareable = entries.map((entry) => ({ ...entry, shareable: true }));
    const nodes = buildPlanTree(shareable);
    const shared = setShared(EMPTY_IMPORT_DRAFT, nodes, 'roadmap', true);
    expect(shared).toEqual({
      ...EMPTY_IMPORT_DRAFT,
      shared: ['roadmap', 'q3'],
    });
    expect(
      sharingSummary(shareable, { ...shared, excluded: ['wiki'] }, true)
    ).toBe('2 shared with your team');
    expect(
      sharingSummary(
        shareable,
        {
          ...shared,
          excluded: ['wiki', 'roadmap', 'q3'],
        },
        true
      )
    ).toBe('');
  });
});

describe('already in Macro', () => {
  const copy = (by: string) => ({
    by,
    entityId: `doc-${by}`,
    entityType: 'md',
  });
  const withCopies = entries.map(
    (entry): ImportPlanEntry =>
      entry.id === 'wiki'
        ? { ...entry, alreadyImported: copy('ana@acme.com') }
        : entry.id === 'q3'
          ? { ...entry, alreadyImported: copy('bo@acme.com') }
          : entry
  );

  it('leaves copies out of the tree and moves their children up', () => {
    const nodes = buildPlanTree(planTreeEntries(withCopies));
    expect(nodes.map((node) => [node.id, node.depth])).toEqual([
      ['roadmap', 0],
      ['scratch', 0],
      ['billing', 0],
    ]);
    const nested = buildPlanTree(
      planTreeEntries(
        entries.map((entry) =>
          entry.id === 'roadmap'
            ? { ...entry, alreadyImported: copy('ana@acme.com') }
            : entry
        )
      )
    );
    expect(nested.map((node) => [node.id, node.depth, node.parentId])).toEqual([
      ['wiki', 0, null],
      ['q3', 1, 'wiki'],
      ['scratch', 1, 'wiki'],
      ['billing', 0, 'gone'],
    ]);
  });

  it('counts only new objects in the import, and Notion still shared them all', () => {
    expect(importCount(withCopies, [])).toBe(1);
    expect(volumeLabel(importVolume(withCopies, []))).toBe('40 tasks');
    expect(planCounts(withCopies).pages).toBe(4);
    expect(alreadyInMacroSummary(withCopies)).toBe(
      '2 already in Macro (imported by ana@acme.com, bo@acme.com)'
    );
    expect(alreadyInMacroSummary(entries)).toBe('');
  });
});

describe('planSummary', () => {
  it('reads the plan size and decisions', () => {
    expect(planSummary(planCounts(entries), importVolume(entries, []))).toBe(
      'Notion shared 4 pages and 1 database — importing 2 pages, 40 tasks · 1 skipped, 1 needs you'
    );
  });
});

describe('importVolume', () => {
  it('counts every row a database or task list writes, without what was left out', () => {
    const database: ImportPlanEntry = {
      id: 'bugs',
      parentId: null,
      kind: 'database',
      title: 'Bugs',
      decision: 'copy',
      reason: null,
      rows: 405,
      status: 'staged',
      error: null,
      ...unshared,
    };
    const all = [...entries, database];
    expect(importVolume(all, [])).toEqual({
      documents: 2,
      databases: 1,
      rows: 405,
      taskLists: 1,
      tasks: 40,
    });
    expect(volumeLabel(importVolume(all, []))).toBe(
      '2 pages, 1 database (405 rows), 40 tasks'
    );
    expect(volumeLabel(importVolume(all, ['roadmap', 'bugs']))).toBe('2 pages');
    expect(volumeLabel(importVolume([], []))).toBe('nothing');
  });
});

describe('importReviewPhase', () => {
  const progress: ImportProgress = {
    reviewId: 'review',
    status: 'importing',
    error: null,
    scanned: null,
    onTeam: true,
    counts: planCounts(entries),
    imported: 1,
    waiting: 1,
    writing: 1,
    failures: [],
  };

  it('follows the review item until the plan is approved', () => {
    expect(
      importReviewPhase({ presentedAt: null }, undefined, undefined)
    ).toEqual({ kind: 'preparing' });
    expect(
      importReviewPhase({ presentedAt: 1 }, { status: 'pending' }, progress)
    ).toEqual({ kind: 'plan' });
    expect(
      importReviewPhase(
        { presentedAt: 1 },
        { status: 'pending' },
        { ...progress, status: 'running' }
      )
    ).toEqual({ kind: 'planning' });
    expect(
      importReviewPhase({ presentedAt: 1 }, { status: 'dismissed' }, undefined)
    ).toEqual({ kind: 'dismissed' });
  });

  it('follows the run once the plan is approved', () => {
    const completed = { status: 'completed' as const };
    expect(importReviewPhase({ presentedAt: 1 }, completed, progress)).toEqual({
      kind: 'importing',
    });
    expect(
      importReviewPhase({ presentedAt: 1 }, completed, {
        ...progress,
        status: 'dismissed',
        error: 'Cancelled',
      })
    ).toEqual({ kind: 'stopped' });
    expect(
      importReviewPhase({ presentedAt: 1 }, completed, {
        ...progress,
        status: 'failed',
        error: 'Notion is unreachable',
      })
    ).toEqual({ kind: 'failed', error: 'Notion is unreachable' });
    expect(
      importReviewPhase({ presentedAt: 1 }, completed, {
        ...progress,
        status: null,
      })
    ).toEqual({ kind: 'completed' });
    expect(importReviewPhase({ presentedAt: 1 }, completed, undefined)).toEqual(
      { kind: 'importing' }
    );
  });
});

describe('planning', () => {
  const running: ImportProgress = {
    reviewId: 'review',
    status: 'running',
    error: null,
    scanned: { pages: 40, databases: 12 },
    onTeam: true,
    counts: planCounts([]),
    imported: 0,
    waiting: 0,
    writing: 0,
    failures: [],
  };

  it('reads Notion until the plan is staged, then counts what is decided', () => {
    expect(planningStatus(running, [])).toBe(
      'Reading Notion: 40 pages, 12 databases'
    );
    expect(planningStatus({ ...running, scanned: null }, [])).toBe(
      'Reading Notion…'
    );
    const staged = entries.map((entry, index) =>
      index < 2 ? entry : { ...entry, decision: null }
    );
    expect(planningStatus(running, staged)).toBe(
      'Deciding what to import: 2 of 5 decided'
    );
    expect(planCounts(staged).deciding).toBe(3);
    expect(importVolume(staged, [])).toEqual({
      documents: 1,
      databases: 0,
      rows: 0,
      taskLists: 1,
      tasks: 40,
    });
  });

  it('says why nothing is shared without a team', () => {
    expect(sharingSummary(entries, EMPTY_IMPORT_DRAFT, false)).toBe(
      "3 only you — you're not on a team, so nothing is shared"
    );
  });
});

describe('planTotals', () => {
  it('totals the plan per kind and leaves empty kinds out', () => {
    const database: ImportPlanEntry = {
      id: 'bugs',
      parentId: null,
      kind: 'database',
      title: 'Bugs',
      decision: 'copy',
      reason: null,
      rows: 405,
      status: 'staged',
      error: null,
      ...unshared,
    };
    const copied: ImportPlanEntry = {
      ...database,
      id: 'crm',
      title: 'CRM',
      alreadyImported: {
        by: 'ana@acme.com',
        entityId: 'db',
        entityType: 'database',
      },
    };
    expect(planTotals([...entries, database, copied], [])).toEqual([
      { label: 'Documents', value: '2' },
      { label: 'Databases', value: '1 (405 rows)' },
      { label: 'Task lists', value: '1 (40 tasks)' },
      { label: 'Skipped', value: '1' },
      { label: 'Already in Macro', value: '1' },
    ]);
  });
});
