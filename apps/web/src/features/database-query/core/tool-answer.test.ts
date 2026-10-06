import { describe, expect, it } from 'vitest';
import { toolAnswers } from './tool-answer';

describe('QueryDatabase tool results as answers', () => {
  it('keeps the tool’s typed cells, with option labels and entity targets as sources', () => {
    expect(
      toolAnswers({
        results: [
          {
            columns: [
              { name: 'Name', kind: 'text' },
              {
                name: 'RSVP',
                kind: 'select',
                options: [{ id: 'option-yes', label: 'Yes' }],
              },
              { name: 'Host', kind: 'entity', target: 'USER' },
              {
                name: 'Parties',
                kind: 'entity',
                target: 'DATABASE_ROW',
                relatedTable: 'table-parties',
              },
              { name: 'Starts', kind: 'date' },
            ],
            rows: [
              [
                { type: 'text', value: 'Ada' },
                { type: 'options', value: ['option-yes'] },
                { type: 'entities', value: ['macro|ada@x.test'] },
                { type: 'entities', value: ['row-party'] },
                { type: 'date', value: '2026-06-01T18:30:00Z' },
              ],
              [{ type: 'text', value: 'Grace' }, null, null, null, null],
            ],
            rowIds: ['row-ada', 'row-grace'],
          },
        ],
        changesApplied: 0,
        readVersions: [{ tableId: 'table-guests', version: 4 }],
        statement: { kind: 'select' },
        summary: 'Read 2 rows.',
      })
    ).toEqual([
      {
        columns: [
          { name: 'Name', kind: 'text' },
          {
            name: 'RSVP',
            kind: 'select',
            source: {
              markdown: false,
              options: [{ id: 'option-yes', label: 'Yes', color: null }],
              tag: false,
              target: null,
              relatedTable: null,
            },
          },
          {
            name: 'Host',
            kind: 'entity',
            source: {
              markdown: false,
              options: [],
              tag: false,
              target: 'USER',
              relatedTable: null,
            },
          },
          {
            name: 'Parties',
            kind: 'entity',
            source: {
              markdown: false,
              options: [],
              tag: false,
              target: 'DATABASE_ROW',
              relatedTable: 'table-parties',
            },
          },
          { name: 'Starts', kind: 'date' },
        ],
        rows: [
          [
            { type: 'text', value: 'Ada' },
            { type: 'options', value: ['option-yes'] },
            { type: 'entities', value: ['macro|ada@x.test'] },
            { type: 'entities', value: ['row-party'] },
            { type: 'date', value: '2026-06-01T18:30:00Z' },
          ],
          [{ type: 'text', value: 'Grace' }, null, null, null, null],
        ],
        rowIds: ['row-ada', 'row-grace'],
        readTables: ['table-guests'],
        readDatabaseIds: [],
        truncatedTables: [],
      },
    ]);
  });
});
