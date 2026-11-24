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

  it('leaves an in: naming no view for the search service, which reads it as a label', () => {
    expect(parseEmailSearch('in:berlin offsite')).toEqual({
      query: 'in:berlin offsite',
    });
  });

  it('keeps the operators the search service reads, a quoted value whole', () => {
    expect(
      parseEmailSearch('in:sent subject:"team  lunch" -from:ana is:unread')
    ).toEqual({
      query: 'subject:"team  lunch" -from:ana is:unread',
      scope: 'sent',
    });
  });

  it('leaves an operator still being typed out of the words', () => {
    expect(parseEmailSearch('invoice is:un')).toEqual({ query: 'invoice' });
    expect(parseEmailSearch('invoice subject:')).toEqual({ query: 'invoice' });
    expect(parseEmailSearch('after:2026/06')).toEqual({ query: '' });
    expect(parseEmailSearch('invoice is:important')).toEqual({
      query: 'invoice is:important',
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

  it('leaves an in: still being typed plain, and marks one naming a label', () => {
    expect(emailSearchTextParts('invoice in:se')).toEqual([
      { text: 'invoice in:se', operator: false },
    ]);
    expect(emailSearchTextParts('in:berlin offsite')).toEqual([
      { text: 'in:berlin', operator: true },
      { text: ' offsite', operator: false },
    ]);
  });

  it('marks every operator the search service reads, and only those', () => {
    expect(
      emailSearchTextParts(
        'lunch subject:"team lunch" -from:ana is:un newer_than:7d -in:signal'
      )
    ).toEqual([
      { text: 'lunch ', operator: false },
      { text: 'subject:"team lunch"', operator: true },
      { text: ' ', operator: false },
      { text: '-from:ana', operator: true },
      { text: ' is:un ', operator: false },
      { text: 'newer_than:7d', operator: true },
      { text: ' -in:signal', operator: false },
    ]);
  });

  it('marks in:focus, which Mail reads itself', () => {
    expect(emailSearchTextParts('in:focus')).toEqual([
      { text: 'in:focus', operator: true },
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
    expect(completeEmailSearch('subject:"team  lunch" is:un')).toBe(
      'subject:"team  lunch"'
    );
  });
});
