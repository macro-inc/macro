import { describe, expect, it } from 'vitest';
import {
  isScalarAnswer,
  parseQueryProposal,
  type QueryAnswer,
  queryErrorMessage,
  queryFailureDetail,
  unquoteIdentifier,
} from './query';

describe('unquoteIdentifier', () => {
  it('takes the table segment of a database-qualified name', () => {
    expect(unquoteIdentifier('"Untitled database"."Table 1"')).toBe('Table 1');
    expect(unquoteIdentifier('"my""db"."a""b"')).toBe('a"b');
    expect(unquoteIdentifier('"Status"')).toBe('Status');
  });
});

describe('database questions', () => {
  it('validates structured AI responses before review', () => {
    expect(
      parseQueryProposal({
        sql: '```sql\nSELECT COUNT(*) FROM projects\n```',
        explanation: 'Counts projects.',
      })._unsafeUnwrap()
    ).toEqual({
      sql: 'SELECT COUNT(*) FROM projects',
      explanation: 'Counts projects.',
    });
    expect(
      parseQueryProposal({
        sql: 'DELETE FROM projects',
        explanation: 'Deletes projects.',
      })._unsafeUnwrapErr()
    ).toEqual({
      kind: 'generation',
      message:
        'Ask a question about your data. To make changes, use the table or board.',
    });
    expect(
      parseQueryProposal({
        sql: 'WITH open AS (SELECT * FROM projects) SELECT COUNT(*) FROM open',
        explanation: 'Counts open projects.',
      })._unsafeUnwrapErr()
    ).toEqual({
      kind: 'generation',
      message:
        'Ask a question about your data. To make changes, use the table or board.',
    });
    expect(parseQueryProposal({ sql: 'SELECT 1' })._unsafeUnwrapErr()).toEqual({
      kind: 'generation',
      message: 'AI returned an incomplete question. Try again.',
    });
  });
  it('only calls exactly one cell a scalar, including null', () => {
    const answer: QueryAnswer = {
      columns: [{ name: 'Answer', kind: 'number' }],
      rows: [[null]],
      rowIds: [],
      readTables: [],
      readDatabaseIds: [],
      truncatedTables: [],
    };
    expect(isScalarAnswer(answer)).toBe(true);
    expect(isScalarAnswer({ ...answer, rows: [] })).toBe(false);
    expect(isScalarAnswer({ ...answer, rows: [[null], [null]] })).toBe(false);
    expect(
      isScalarAnswer({
        ...answer,
        columns: [
          { name: 'Answer', kind: 'number' },
          { name: 'Other', kind: 'number' },
        ],
        rows: [[null, null]],
      })
    ).toBe(false);
  });
});

describe('queryErrorMessage', () => {
  it('explains a cancelled read without presenting it as an engine failure', () => {
    expect(queryErrorMessage({ kind: 'cancelled' }, false)).toBe(
      'This request was cancelled. Try asking again.'
    );
  });
  it('explains that questions only read when a write is refused', () => {
    expect(queryErrorMessage({ kind: 'read-only' }, false)).toBe(
      'Questions only read your data. Ask a question about it above.'
    );
    expect(queryErrorMessage({ kind: 'read-only' }, true)).toBe(
      'Questions only read your data. Start with SELECT, or ask a question above.'
    );
  });

  it('words the service failures it knows by code', () => {
    expect(
      queryErrorMessage(
        {
          kind: 'question',
          error: { code: 'NOT_FOUND', message: '' },
        },
        false
      )
    ).toBe('This saved question no longer exists.');
    expect(
      queryErrorMessage(
        {
          kind: 'question',
          error: { code: 'QUERY_TOO_LONG', message: 'query is too long' },
        },
        false
      )
    ).toBe('This question is too long to save. Try a shorter question.');
    expect(
      queryErrorMessage(
        {
          kind: 'question',
          error: { code: 'SERVER_ERROR', message: 'internal server error' },
        },
        false
      )
    ).toBe('Something went wrong reaching your data. Try again.');
    expect(
      queryErrorMessage(
        {
          kind: 'databases',
          error: { code: 'GONE', message: '' },
        },
        false
      )
    ).toBe(
      'This table is no longer available. Choose a database and update the question.'
    );
    expect(
      queryErrorMessage({ kind: 'fetch', message: 'Failed to fetch' }, false)
    ).toBe('Your data could not be reached. Check your connection.');
    expect(queryErrorMessage({ kind: 'table-unavailable' }, false)).toBe(
      'Choose an available table before asking this question.'
    );
  });
});

describe('queryErrorMessage with SQL hidden', () => {
  it('turns the engine’s words, which quote the statement, into a plain line', () => {
    expect(
      queryErrorMessage(
        {
          kind: 'engine',
          error: {
            stage: 'parse',
            span: { start: 14, end: 14 },
            message: 'expected FROM, found end of input',
          },
          message: 'expected FROM, found end of input at byte 14',
        },
        false
      )
    ).toBe("This answer couldn't be computed. Try asking again.");
    expect(
      queryErrorMessage(
        { kind: 'crash', message: 'wasm failed to load' },
        false
      )
    ).toBe("This answer couldn't be computed. Try asking again.");
  });

  it('keeps authored messages and the raw engine text when SQL is shown', () => {
    expect(
      queryErrorMessage(
        {
          kind: 'generation',
          message: 'Try a question about the properties in this database.',
        },
        false
      )
    ).toBe('Try a question about the properties in this database.');
    expect(
      queryErrorMessage(
        {
          kind: 'engine',
          error: {
            stage: 'parse',
            span: { start: 14, end: 14 },
            message: 'expected FROM, found end of input',
          },
          message: 'expected FROM, found end of input at byte 14',
        },
        true
      )
    ).toBe('expected FROM, found end of input at byte 14');
    expect(
      queryErrorMessage(
        {
          kind: 'question',
          error: { code: 'QUERY_TOO_LONG', message: 'query is too long' },
        },
        true
      )
    ).toBe(
      'This question’s SQL is too long to save. Shorten it and try again.'
    );
  });
});

describe('engine refusals in the reader’s terms', () => {
  it('names the column, table or option a question no longer matches', () => {
    expect(
      queryErrorMessage(
        {
          kind: 'engine',
          error: {
            stage: 'resolve',
            kind: 'unknownColumn',
            name: 'Stage',
            table: 'CRM.Deals',
            suggestion: 'Status',
          },
          message:
            'unknown column "Stage" in CRM.Deals — did you mean "Status"?',
        },
        false
      )
    ).toBe(
      "This answer couldn't be computed: the column Stage no longer exists."
    );
    expect(
      queryErrorMessage(
        {
          kind: 'engine',
          error: {
            stage: 'resolve',
            kind: 'unknownTable',
            name: 'Guests',
            suggestion: null,
          },
          message: 'unknown table Guests',
        },
        false
      )
    ).toBe(
      "This answer couldn't be computed: the table Guests no longer exists."
    );
    expect(
      queryErrorMessage(
        {
          kind: 'engine',
          error: {
            stage: 'resolve',
            kind: 'ambiguousTable',
            name: 'Tasks',
            databases: ['Work', 'Home'],
          },
          message: 'table "Tasks" exists in Work, Home',
        },
        false
      )
    ).toBe(
      "This answer couldn't be computed: more than one database has a table named Tasks."
    );
    expect(
      queryErrorMessage(
        {
          kind: 'engine',
          error: {
            stage: 'resolve',
            kind: 'unknownOption',
            column: 'RSVP',
            label: 'Perhaps',
            options: ['Yes', 'No', 'Maybe'],
          },
          message: '"Perhaps" is not an option of "RSVP"',
        },
        false
      )
    ).toBe(
      "This answer couldn't be computed: Perhaps is not an option of RSVP."
    );
  });

  it('says a column cannot be used that way, and when a request reads too much', () => {
    expect(
      queryErrorMessage(
        {
          kind: 'engine',
          error: {
            stage: 'resolve',
            kind: 'hasOnSingleValued',
            column: 'Owner',
          },
          message: '"Owner" holds one value; use = instead of HAS',
        },
        false
      )
    ).toBe("This answer couldn't be computed: Owner can't be used that way.");
    expect(
      queryErrorMessage(
        {
          kind: 'engine',
          error: {
            stage: 'resolve',
            kind: 'typeMismatch',
            column: 'Budget',
            expected: 'number',
            hint: 'compare it to a number',
          },
          message: '"Budget" is a number column',
        },
        false
      )
    ).toBe(
      "This answer couldn't be computed: Budget holds number values, which don't fit this question."
    );
    expect(
      queryErrorMessage(
        {
          kind: 'engine',
          error: { stage: 'tooManyRows', limit: 10000 },
          message: 'the WHERE matches more than 10000 rows',
        },
        false
      )
    ).toBe('This request matches too many records. Try a narrower request.');
  });
});

describe('queryFailureDetail', () => {
  it('is the engine’s or the service’s own words', () => {
    expect(
      queryFailureDetail({
        kind: 'engine',
        error: {
          stage: 'resolve',
          kind: 'unknownTable',
          name: 'Old',
          suggestion: null,
        },
        message: 'unknown table "Old"',
      })
    ).toBe('unknown table "Old"');
    expect(
      queryFailureDetail({
        kind: 'question',
        error: { code: 'QUERY_TOO_LONG', message: 'query is too long' },
      })
    ).toBe('query is too long');
    expect(queryFailureDetail({ kind: 'read-only' })).toBeUndefined();
  });
});
