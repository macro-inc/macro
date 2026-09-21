import { describe, expect, it } from 'vitest';
import {
  isScalarAnswer,
  parseQueryProposal,
  type QuerySchema,
  queryStarters,
} from './query';

const schema: QuerySchema = {
  databaseId: 'db',
  name: 'Projects',
  tables: [
    {
      id: 'table',
      name: 'Projects',
      sqlName: 'my"projects',
      columns: [
        {
          name: 'Status',
          sqlName: 'status',
          type: 'SelectString',
          options: ['In progress', 'Done'],
          multiple: false,
        },
      ],
    },
  ],
};
describe('database questions', () => {
  it('does not silently replace an unavailable selected table with the first table', () => {
    expect(queryStarters({ ...schema, focusTableId: 'removed-table' })).toEqual(
      []
    );
  });
  it('targets the active table without removing tables needed for cross-table questions', () => {
    const focused: QuerySchema = {
      ...schema,
      focusTableId: 'people',
      tables: [
        ...schema.tables,
        {
          id: 'people',
          name: 'People',
          sqlName: 'team_people',
          columns: [],
        },
      ],
    };
    const starters = queryStarters(focused);
    expect(starters[0].prompt).toBe('How many records are in People?');
    expect(starters[0].sql).toContain('FROM "team_people"');
    expect(starters[1].sql).toContain('FROM "team_people"');
    expect(focused.tables).toHaveLength(2);
  });

  it('builds starters from actual SQL names and only groups scalar options', () => {
    expect(queryStarters(schema)[0].sql).toContain('"my""projects"');
    expect(queryStarters(schema)[2].sql).toContain('GROUP BY "status"');
    expect(
      queryStarters({
        ...schema,
        tables: [
          {
            ...schema.tables[0],
            columns: [{ ...schema.tables[0].columns[0], multiple: true }],
          },
        ],
      })
    ).toHaveLength(2);
  });
  it('validates structured AI responses before review', () => {
    expect(
      parseQueryProposal({
        sql: '```sql\nSELECT COUNT(*) FROM projects\n```',
        explanation: 'Counts projects.',
      }).sql
    ).toBe('SELECT COUNT(*) FROM projects');
    expect(() =>
      parseQueryProposal({
        sql: 'DELETE FROM projects',
        explanation: 'Deletes projects.',
      })
    ).toThrow('Ask a question');
    expect(() => parseQueryProposal({ sql: 'SELECT 1' })).toThrow('incomplete');
  });
  it('only calls exactly one cell a scalar, including null', () => {
    const answer = {
      results: [
        { columns: [{ name: 'Answer', entity_type: null }], rows: [[null]] },
      ],
      read_tables: [],
      read_versions: {},
      truncated_tables: [],
    };
    expect(isScalarAnswer(answer)).toBe(true);
    expect(
      isScalarAnswer({
        ...answer,
        results: [{ ...answer.results[0], rows: [] }],
      })
    ).toBe(false);
    expect(
      isScalarAnswer({
        ...answer,
        results: [...answer.results, ...answer.results],
      })
    ).toBe(false);
  });
});
