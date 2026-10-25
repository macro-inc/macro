import type { ImportEntity } from '@queries/import';
import { describe, expect, it } from 'vitest';
import { decodeImportDraft, decodePlanEntries } from './import-plan';

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

describe('decodeImportDraft', () => {
  it('reads the excluded and re-shared rows and rejects other drafts', () => {
    expect(decodeImportDraft({ source: 'notion' })).toEqual({
      source: 'notion',
      excluded: [],
      shared: [],
      personal: [],
    });
    expect(
      decodeImportDraft({
        source: 'notion',
        excluded: ['roadmap'],
        shared: ['wiki'],
        personal: ['q3'],
      })
    ).toEqual({
      source: 'notion',
      excluded: ['roadmap'],
      shared: ['wiki'],
      personal: ['q3'],
    });
    expect(decodeImportDraft({ subject: 'Hi' })).toBeUndefined();
  });
});
