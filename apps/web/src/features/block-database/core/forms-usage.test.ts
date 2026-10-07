import { describe, expect, it } from 'vitest';
import { columnDeleteNote, tableDeleteConsequence } from './forms-usage';

describe('tableDeleteConsequence', () => {
  it('names the forms deleted with a table, and never claims none while unsure', () => {
    expect(
      tableDeleteConsequence({ kind: 'known', names: ['RSVP'], gated: [] })
    ).toBe('The form “RSVP” writes to it and will be deleted with it.');
    expect(
      tableDeleteConsequence({
        kind: 'known',
        names: ['RSVP', 'Lunch'],
        gated: [],
      })
    ).toBe(
      'The forms “RSVP”, “Lunch” write to it and will be deleted with it.'
    );
    expect(
      tableDeleteConsequence({ kind: 'known', names: [], gated: [] })
    ).toBe(undefined);
    expect(tableDeleteConsequence({ kind: 'checking' })).toBe(
      'Checking which forms write to it…'
    );
    expect(tableDeleteConsequence({ kind: 'unknown' })).toBe(
      'Couldn’t check which forms write to it. Any that do are deleted with it.'
    );
  });
});

describe('columnDeleteNote', () => {
  it('names the forms asking a column, and never claims none while unsure', () => {
    expect(
      columnDeleteNote({ kind: 'known', names: ['RSVP'], gated: [] })
    ).toBe('Asked by “RSVP”: the question leaves the form with it.');
    expect(columnDeleteNote({ kind: 'known', names: [], gated: [] })).toBe(
      undefined
    );
    expect(columnDeleteNote({ kind: 'checking' })).toBe(
      'Checking which forms ask it…'
    );
    expect(columnDeleteNote({ kind: 'unknown' })).toBe(
      'Couldn’t check which forms ask it. Any that do lose the question.'
    );
  });

  it('warns that forms whose gate checks the column stop taking responses', () => {
    expect(
      columnDeleteNote({ kind: 'known', names: ['RSVP'], gated: ['RSVP'] })
    ).toBe(
      'Asked by “RSVP”: the question leaves the form with it. “RSVP” checks it in a gate, so it stops taking responses until the gate is fixed.'
    );
    expect(
      columnDeleteNote({ kind: 'known', names: [], gated: ['Lunch'] })
    ).toBe(
      '“Lunch” checks it in a gate, so it stops taking responses until the gate is fixed.'
    );
  });
});
