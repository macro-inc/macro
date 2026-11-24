import { describe, expect, it } from 'vitest';
import {
  completeEmailSearch,
  emailSearchTextParts,
  parseEmailSearch,
} from './email-search-scope';

describe('parseEmailSearch', () => {
  it('searches the words as typed when no view is named', () => {
    expect(parseEmailSearch('quarterly invoice')).toEqual({
      query: 'quarterly invoice',
    });
  });

  it('takes the view from an in: filter anywhere in the text, in any case', () => {
    expect(parseEmailSearch('in:sent invoice')).toEqual({
      query: 'invoice',
      scope: 'sent',
    });
    expect(parseEmailSearch('invoice IN:Archived')).toEqual({
      query: 'invoice',
      scope: 'archived',
    });
  });

  it('keeps the last view named', () => {
    expect(parseEmailSearch('in:sent in:noise invoice')).toEqual({
      query: 'invoice',
      scope: 'noise',
    });
  });

  it('leaves an in: still being typed out of the words', () => {
    expect(parseEmailSearch('invoice in:')).toEqual({ query: 'invoice' });
    expect(parseEmailSearch('invoice in:se')).toEqual({ query: 'invoice' });
  });

  it('searches for an in: that names no view as a word', () => {
    expect(parseEmailSearch('in:berlin offsite')).toEqual({
      query: 'in:berlin offsite',
    });
  });
});

describe('emailSearchTextParts', () => {
  it('marks a whole, known in: filter as an operator wherever it is typed', () => {
    expect(emailSearchTextParts('invoice in:sent march')).toEqual([
      { text: 'invoice ', operator: false },
      { text: 'in:sent', operator: true },
      { text: ' march', operator: false },
    ]);
    expect(emailSearchTextParts('IN:Archived')).toEqual([
      { text: 'IN:Archived', operator: true },
    ]);
  });

  it('leaves an in: still being typed, or naming no view, plain', () => {
    expect(emailSearchTextParts('invoice in:se')).toEqual([
      { text: 'invoice in:se', operator: false },
    ]);
    expect(emailSearchTextParts('in:berlin offsite')).toEqual([
      { text: 'in:berlin offsite', operator: false },
    ]);
  });
});

describe('completeEmailSearch', () => {
  it('keeps the search as typed but drops an in: still being typed', () => {
    expect(completeEmailSearch('invoice  in:sent march')).toBe(
      'invoice in:sent march'
    );
    expect(completeEmailSearch('invoice in:se')).toBe('invoice');
    expect(completeEmailSearch('in:berlin offsite')).toBe('in:berlin offsite');
  });
});
