import { describe, expect, it } from 'vitest';
import {
  editEmailSearchField,
  parseEmailSearch,
  splitEmailSearchField,
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

describe('splitEmailSearchField', () => {
  it('shows the view a search runs in as the chip, wherever it was named', () => {
    expect(splitEmailSearchField('in:sent invoice')).toEqual({
      scope: 'sent',
      text: 'invoice',
    });
    expect(splitEmailSearchField('in:sent')).toEqual({
      scope: 'sent',
      text: '',
    });
    expect(splitEmailSearchField('invoice in:sent')).toEqual({
      scope: 'sent',
      text: 'invoice ',
    });
  });

  it('shows the same view the search runs in when a stored search names two', () => {
    const stored = 'in:sent invoice in:drafts';
    expect(splitEmailSearchField(stored).scope).toBe(
      parseEmailSearch(stored).scope
    );
    expect(splitEmailSearchField(stored).text).toBe('invoice ');
  });

  it('leaves an in: still being typed, or naming no view, in the text', () => {
    expect(splitEmailSearchField('invoice in:se')).toEqual({
      text: 'invoice in:se',
    });
    expect(splitEmailSearchField('in:berlin offsite')).toEqual({
      text: 'in:berlin offsite',
    });
  });
});

describe('editEmailSearchField', () => {
  it('turns a view named in full into the chip at once and keeps the rest', () => {
    expect(editEmailSearchField(undefined, 'in:sent')).toBe('in:sent ');
    expect(editEmailSearchField(undefined, 'invoice in:sent')).toBe(
      'in:sent invoice '
    );
    expect(editEmailSearchField(undefined, 'invoice in:sent march')).toBe(
      'in:sent invoice march'
    );
  });

  it('replaces the chip when another view is named, so they never disagree', () => {
    expect(editEmailSearchField('sent', 'invoice in:drafts')).toBe(
      'in:drafts invoice '
    );
  });

  it('keeps the chip while the text after it changes', () => {
    expect(editEmailSearchField('sent', 'invoice')).toBe('in:sent invoice');
    expect(editEmailSearchField('sent', 'in:se')).toBe('in:sent in:se');
    expect(editEmailSearchField('sent', '')).toBe('in:sent ');
  });

  it('leaves text without a view as typed', () => {
    expect(editEmailSearchField(undefined, 'invoice')).toBe('invoice');
    expect(editEmailSearchField(undefined, 'in:berlin ')).toBe('in:berlin ');
  });
});
