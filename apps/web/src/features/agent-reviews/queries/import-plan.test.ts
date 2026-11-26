import type { ImportEntity, NotionImportReport } from '@queries/import';
import { describe, expect, it } from 'vitest';
import { decodeImportProgress, decodePlanEntries } from './import-plan';

const row: ImportEntity = {
  id: 'roadmap',
  user_id: 'owner',
  source: 'notion',
  kind: 'data_source',
  foreign_id: 'notion-roadmap',
  parent_id: 'wiki',
  review_id: 'review',
  status: 'staged',
  initiator: 'chat',
  metadata: {
    title: 'Roadmap',
    url: 'https://notion.so/roadmap',
    plan: {
      decision: 'tasks',
      reason: 'Rows have a status',
      path: ['Wiki'],
      rows: 40,
      sampleTitles: ['Fix login', 'Ship billing'],
      taskFields: { status: 'Status' },
    },
  },
  last_error: 'Rate limited',
  created_at: '2026-10-19T00:00:00Z',
  updated_at: '2026-10-19T00:00:00Z',
};

describe('decodePlanEntries', () => {
  it("keeps this review's Notion plan rows", () => {
    expect(
      decodePlanEntries(
        [
          row,
          { ...row, id: 'older', review_id: 'older-review' },
          { ...row, id: 'single', metadata: { title: 'Staged alone' } },
          { ...row, id: 'slack', source: 'slack' },
        ],
        'review'
      )
    ).toEqual([
      {
        id: 'roadmap',
        parentId: 'wiki',
        kind: 'database',
        title: 'Roadmap',
        decision: 'tasks',
        reason: 'Rows have a status',
        rows: 40,
        sampleTitles: ['Fix login', 'Ship billing'],
        taskFields: {
          status: 'Status',
          priority: null,
          due: null,
          assignee: null,
        },
        status: 'staged',
        error: 'Rate limited',
        shared: false,
        sharedReason: null,
        shareable: false,
        alreadyImported: null,
      },
    ]);
  });

  it('reads sharing and a teammate copy', () => {
    expect(
      decodePlanEntries(
        [
          {
            ...row,
            kind: 'page',
            metadata: {
              title: 'Wiki',
              plan: {
                decision: 'copy',
                path: [],
                shared: true,
                sharedReason: 'Team handbook',
                shareable: true,
                alreadyImported: {
                  by: 'ana@acme.com',
                  entityId: 'doc-1',
                  entityType: 'md',
                },
              },
            },
          },
        ],
        'review'
      )
    ).toMatchObject([
      {
        id: 'roadmap',
        shared: true,
        sharedReason: 'Team handbook',
        shareable: true,
        alreadyImported: {
          by: 'ana@acme.com',
          entityId: 'doc-1',
          entityType: 'md',
        },
      },
    ]);
  });
});

describe('decodePlanEntries while planning', () => {
  it('reads a row the decision model has not answered for yet', () => {
    expect(
      decodePlanEntries(
        [
          {
            ...row,
            metadata: {
              title: 'Roadmap',
              plan: { path: [], rows: 40, shared: false, shareable: false },
            },
          },
        ],
        'review'
      )
    ).toMatchObject([{ id: 'roadmap', decision: null, rows: 40 }]);
  });
});

it('decodes tracker tasks and projects while isolating review ids', () => {
  const decoded = decodePlanEntries(
    [
      { ...row, id: 'l', source: 'linear', kind: 'issue' },
      { ...row, id: 'j', source: 'jira', kind: 'jira_issue' },
      { ...row, id: 'p', source: 'jira', kind: 'jira_project' },
      { ...row, id: 'e', source: 'jira', kind: 'jira_epic' },
      { ...row, source: 'jira', review_id: 'other' },
    ],
    'review'
  );
  expect(decoded.map(({ id, kind }) => ({ id, kind }))).toEqual([
    { id: 'l', kind: 'task' },
    { id: 'j', kind: 'task' },
    { id: 'p', kind: 'project' },
    { id: 'e', kind: 'project' },
  ]);
});

it('labels dependencies from current-review objects without reviving older titles', () => {
  const entries = decodePlanEntries(
    [
      {
        ...row,
        id: 'page',
        kind: 'page',
        foreign_id: 'notion-page',
        metadata: { title: 'Project', plan: { decision: 'copy' } },
      },
      {
        ...row,
        id: 'dependency',
        metadata: {
          title: 'Work',
          plan: { decision: 'copy', dependencyOf: ['notion-page'] },
        },
      },
      {
        ...row,
        id: 'inline-source',
        metadata: {
          title: 'Selected database',
          plan: { decision: 'copy', inlineOn: ['notion-page'] },
        },
      },
      {
        ...row,
        id: 'old-page',
        kind: 'page',
        foreign_id: 'notion-page',
        review_id: 'older',
        metadata: { title: 'Old project', plan: { decision: 'copy' } },
      },
    ],
    'review'
  );
  expect(
    entries.find((entry) => entry.id === 'dependency')?.linkedFrom
  ).toEqual(['Project']);
  expect(
    entries.find((entry) => entry.id === 'inline-source')?.inlineOn
  ).toEqual(['Project']);
});

it('decodes HubSpot pipelines, companies, contacts and deals', () => {
  const kinds = decodePlanEntries(
    [
      { ...row, id: 'p', source: 'hubspot', kind: 'hubspot_pipeline' },
      { ...row, id: 'c', source: 'hubspot', kind: 'hubspot_company' },
      { ...row, id: 'n', source: 'hubspot', kind: 'hubspot_contact' },
      { ...row, id: 'd', source: 'hubspot', kind: 'hubspot_deal' },
    ],
    'review'
  ).map((entry) => [entry.id, entry.kind]);
  expect(kinds).toEqual([
    ['p', 'pipeline'],
    ['c', 'company'],
    ['n', 'contact'],
    ['d', 'deal'],
  ]);
});

it('decodes Attio pipelines, companies, people and deals', () => {
  const kinds = decodePlanEntries(
    [
      { ...row, id: 'p', source: 'attio', kind: 'attio_pipeline' },
      { ...row, id: 'c', source: 'attio', kind: 'attio_company' },
      { ...row, id: 'n', source: 'attio', kind: 'attio_person' },
      { ...row, id: 'd', source: 'attio', kind: 'attio_deal' },
    ],
    'review'
  ).map((entry) => [entry.id, entry.kind]);
  expect(kinds).toEqual([
    ['p', 'pipeline'],
    ['c', 'company'],
    ['n', 'contact'],
    ['d', 'deal'],
  ]);
});

it("reads the CRM section of the review's own source", () => {
  const section = {
    pipelines: 1,
    companies: 2,
    contacts: 3,
    deals: 0,
    owners: 1,
    ownersMatched: 1,
    alreadyImported: 0,
    losses: [{ loss: 'deal_people' as const, count: 2 }],
    customProperties: [],
  };
  const report: NotionImportReport = {
    status: 'ready',
    reviewId: 'review',
    onTeam: true,
    pages: 0,
    dataSources: 0,
    copy: 0,
    tasks: 0,
    skip: 0,
    hand: 0,
    documents: 0,
    databases: 0,
    databaseRows: 0,
    taskRows: 0,
    imported: 0,
    waiting: 0,
    writing: 0,
    attio: section,
  };
  expect(decodeImportProgress(report, 'attio').crm).toEqual({
    owners: 1,
    ownersMatched: 1,
    created: 0,
    linked: 0,
    losses: [{ loss: 'deal_people', count: 2 }],
  });
  expect(decodeImportProgress(report, 'hubspot').crm).toBeNull();
});
