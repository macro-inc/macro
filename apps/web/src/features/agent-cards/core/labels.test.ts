import { describe, expect, it } from 'vitest';
import { documentKind, itemKind } from './labels';

describe('card labels', () => {
  it('name any item by its kind', () => {
    expect(itemKind('document', 'spreadsheet')).toBe('Spreadsheet');
    expect(itemKind('routine')).toBe('Routine');
    expect(itemKind('email_thread')).toBe('Email');
    expect(itemKind('project')).toBe('Folder');
    expect(itemKind('initiative')).toBe('Project');
  });

  it('name a document by its kind', () => {
    expect(documentKind('md')).toBe('Document');
    expect(documentKind('spreadsheet')).toBe('Spreadsheet');
    expect(documentKind('pdf')).toBe('PDF');
    expect(documentKind(undefined)).toBe('Document');
    expect(documentKind('something-new')).toBe('Document');
  });
});
