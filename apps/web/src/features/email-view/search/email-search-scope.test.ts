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
  it('shows a leading view followed by a space as the chip', () => {
    expect(splitEmailSearchField('in:sent invoice')).toEqual({
      scope: 'sent',
      text: 'invoice',
    });
    expect(splitEmailSearchField('in:sent ')).toEqual({
      scope: 'sent',
      text: '',
    });
  });

  it('leaves a view still being typed, or named later, in the text', () => {
    expect(splitEmailSearchField('in:sent')).toEqual({ text: 'in:sent' });
    expect(splitEmailSearchField('invoice in:sent')).toEqual({
      text: 'invoice in:sent',
    });
    expect(splitEmailSearchField('in:berlin offsite')).toEqual({
      text: 'in:berlin offsite',
    });
  });
});

describe('editEmailSearchField', () => {
  it('turns a finished in: filter into the chip and keeps the rest', () => {
    expect(editEmailSearchField(undefined, 'in:sent ')).toBe('in:sent ');
    expect(editEmailSearchField(undefined, 'invoice in:sent ')).toBe(
      'in:sent invoice '
    );
    expect(editEmailSearchField(undefined, 'invoice in:sent march')).toBe(
      'in:sent invoice march'
    );
  });

  it('replaces the chip when another view is finished', () => {
    expect(editEmailSearchField('sent', 'invoice in:noise ')).toBe(
      'in:noise invoice '
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
