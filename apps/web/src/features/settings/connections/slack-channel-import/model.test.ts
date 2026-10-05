import type { ImportEntity, ImportRun, ImportState } from '@queries/import';
import { describe, expect, it, vi } from 'vitest';
import {
  buildRows,
  filterRows,
  matchLabel,
  runLabel,
  selectableIds,
} from './model';

// Keep the real metadata helper, without starting the query module's websocket.
vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: vi.fn(),
}));

function entity(overrides: Partial<ImportEntity> = {}): ImportEntity {
  return {
    id: 'ledger-1',
    user_id: 'me',
    source: 'slack',
    foreign_id: 'C123',
    status: 'staged',
    initiator: 'manual',
    metadata: {
      name: 'Engineering',
      channel_id: 'C123',
      purpose: 'Ship great software',
      archived: false,
      member_count: 10,
      members_resolved: true,
      participants: [{ name: 'Alice', email: 'alice@example.com' }],
    },
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function run(status: ImportRun['status']): ImportRun {
  return { source: 'slack', status, auto_import: false, updated_at: '' };
}

function state(entities: ImportEntity[], runs: ImportRun[] = []): ImportState {
  return { entities, runs };
}

describe('Slack channel rows', () => {
  it('projects Slack metadata and ignores other sources and discarded rows', () => {
    const rows = buildRows(
      state(
        [
          entity(),
          entity({ source: 'linear' }),
          entity({ source: 'notion' }),
          entity({ status: 'discarded' }),
        ],
        [run('running')]
      ),
      'me'
    );
    expect(rows).toEqual([
      {
        id: 'ledger-1',
        channelId: 'C123',
        name: 'Engineering',
        purpose: 'Ship great software',
        archived: false,
        memberCount: 10,
        matched: 1,
        membersResolved: true,
        runStatus: 'running',
        status: 'staged',
        entityId: null,
        entityType: null,
        importedByTeammate: false,
      },
    ]);
  });

  it('handles older metadata without treating unchecked members as zero matches', () => {
    const [row] = buildRows(state([entity({ metadata: {} })]), 'me');
    expect(row).toMatchObject({
      channelId: 'C123',
      name: 'C123',
      purpose: '',
      archived: false,
      memberCount: null,
      matched: 0,
      membersResolved: false,
    });
    expect(matchLabel(row)).toBe('Members not checked yet');
  });

  it('marks only imported rows owned by another known user as teammate imports', () => {
    const imported = entity({
      status: 'imported',
      user_id: 'teammate',
      entity_id: 'macro-channel',
      entity_type: 'channel',
    });
    const [row] = buildRows(state([imported]), 'me');
    expect(row).toMatchObject({
      importedByTeammate: true,
      entityId: 'macro-channel',
      entityType: 'channel',
    });
    expect(buildRows(state([imported]), 'teammate')[0].importedByTeammate).toBe(
      false
    );
    expect(buildRows(state([imported]), undefined)[0].importedByTeammate).toBe(
      false
    );
    expect(
      buildRows(state([entity({ user_id: 'teammate' })]), 'me')[0]
        .importedByTeammate
    ).toBe(false);
  });

  it('selects staged ledger ids only, including unresolved channels', () => {
    const rows = buildRows(
      state([
        entity({ metadata: {} }),
        entity({ id: 'importing', status: 'importing' }),
        entity({ id: 'imported', status: 'imported' }),
      ]),
      'me'
    );
    expect(selectableIds(rows)).toEqual(['ledger-1']);
    expect(selectableIds([])).toEqual([]);
  });
});

describe('channel filtering', () => {
  const rows = buildRows(
    state([
      entity(),
      entity({
        id: 'archived',
        metadata: { name: 'Old Engineering', archived: true },
      }),
    ]),
    'me'
  );

  it.each([
    'engineering',
    'ENGINEERING',
    'software',
    'c123',
    '  Engineering  ',
  ])(
    'searches name, purpose and channel id case-insensitively: %s',
    (search) => {
      expect(
        filterRows(rows, { search, showArchived: false }).map((row) => row.id)
      ).toEqual(['ledger-1']);
    }
  );

  it('hides archived channels unless requested without modifying the source rows', () => {
    expect(filterRows(rows, { search: '', showArchived: false })).toHaveLength(
      1
    );
    expect(filterRows(rows, { search: '', showArchived: true })).toHaveLength(
      2
    );
    expect(
      filterRows(rows, { search: 'old', showArchived: true }).map(
        (row) => row.id
      )
    ).toEqual(['archived']);
    expect(filterRows(rows, { search: 'missing', showArchived: true })).toEqual(
      []
    );
    expect(rows).toHaveLength(2);
  });
});

describe('progress labels', () => {
  it('distinguishes active checks, unresolved members and resolved match counts', () => {
    const [row] = buildRows(state([entity()]), 'me');
    expect(matchLabel(row)).toBe('1 of 10 members are on your team');
    expect(matchLabel({ ...row, memberCount: null })).toBe(
      '1 members on your team'
    );
    expect(matchLabel({ ...row, matched: 0, memberCount: 0 })).toBe(
      '0 of 0 members are on your team'
    );
    expect(
      matchLabel({ ...row, membersResolved: false, runStatus: 'running' })
    ).toBe('Checking members…');
    for (const runStatus of [
      'ready',
      'failed',
      'completed',
      undefined,
    ] as const) {
      expect(matchLabel({ ...row, membersResolved: false, runStatus })).toBe(
        'Members not checked yet'
      );
    }
  });

  it.each([
    ['running', 'Finding channels and checking members…'],
    ['ready', 'Channels ready to import'],
    ['failed', 'Could not find channels'],
    ['importing', 'Importing channels…'],
    ['completed', 'Import complete'],
    ['dismissed', 'Find public Slack channels to import.'],
  ] as const)('labels a %s run', (status, label) => {
    expect(runLabel(run(status))).toBe(label);
  });

  it('prompts discovery when there is no run', () => {
    expect(runLabel(undefined)).toBe('Find public Slack channels to import.');
  });
});
