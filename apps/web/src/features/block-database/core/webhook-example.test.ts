import { describe, expect, it } from 'vitest';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import { webhookCurl, webhookExamplePayload } from './webhook-example';

const meetings: DatabaseViewColumn[] = [
  {
    id: 'title',
    name: 'Title',
    dataType: 'STRING',
    isMultiSelect: false,
    options: [],
    writable: true,
  },
  {
    id: 'date',
    name: 'Date',
    dataType: 'DATE',
    isMultiSelect: false,
    options: [],
    writable: true,
  },
  {
    id: 'attendees',
    name: 'Attendees',
    dataType: 'SELECT_STRING',
    isMultiSelect: true,
    options: [
      { id: 'alice', label: 'Alice', color: null },
      { id: 'bob', label: 'Bob', color: null },
    ],
    writable: true,
  },
  {
    id: 'status',
    name: 'Status',
    dataType: 'SELECT_STRING',
    isMultiSelect: false,
    options: [{ id: 'scheduled', label: 'Scheduled', color: null }],
    writable: true,
  },
  {
    id: 'duration',
    name: 'Duration (min)',
    dataType: 'NUMBER',
    isMultiSelect: false,
    options: [],
    writable: true,
  },
  {
    id: 'recording',
    name: 'Recording',
    dataType: 'LINK',
    isMultiSelect: false,
    options: [],
    writable: true,
  },
  {
    id: 'follow-up',
    name: 'Needs follow-up',
    dataType: 'BOOLEAN',
    isMultiSelect: false,
    options: [],
    writable: true,
  },
  {
    id: 'owner',
    name: 'Owner',
    dataType: 'ENTITY',
    isMultiSelect: false,
    options: [],
    writable: true,
    specificEntityType: 'USER',
  },
  {
    id: 'account',
    name: 'Account',
    dataType: 'ENTITY',
    isMultiSelect: true,
    options: [],
    writable: true,
    relation: { databaseId: 'crm', tableId: 'accounts' },
  },
  {
    id: 'stage',
    name: 'Stage',
    dataType: 'SELECT_STRING',
    isMultiSelect: false,
    options: [],
    writable: true,
  },
];

describe('webhookExamplePayload', () => {
  it('names every column with a value of its type', () => {
    expect(webhookExamplePayload(meetings, '2026-10-09')).toEqual({
      Title: 'Text',
      Date: '2026-10-09',
      Attendees: ['Alice'],
      Status: 'Scheduled',
      'Duration (min)': 1,
      Recording: 'https://example.com',
      'Needs follow-up': true,
      Owner: null,
      Account: null,
      Stage: null,
    });
  });
});

describe('webhookCurl', () => {
  it('quotes the body for a shell, apostrophes included', () => {
    expect(
      webhookCurl('https://api.example/databases/webhooks/mdbw_x', {
        Title: "Alice's kickoff",
      })
    ).toBe(
      `curl -X POST 'https://api.example/databases/webhooks/mdbw_x' \\
  -H 'Content-Type: application/json' \\
  -d '{
  "Title": "Alice'\\''s kickoff"
}'`
    );
  });
});
