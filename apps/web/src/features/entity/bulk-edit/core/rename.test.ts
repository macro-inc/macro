import { describe, expect, it } from 'vitest';
import { renamedEntityName } from './rename';

describe('bulk rename names used for preview and submission', () => {
  it('preserves intentional spaces in prefixes and suffixes', () => {
    expect(
      renamedEntityName('Launch notes', 'prepend', 'Draft — ', '', '')
    ).toBe('Draft — Launch notes');
    expect(
      renamedEntityName('Launch notes', 'append', ' — final', '', '')
    ).toBe('Launch notes — final');
  });
  it('replaces every literal match, leaving non-matches unchanged', () => {
    expect(renamedEntityName('a.b.a.b', 'replace', '', 'a.b', 'draft')).toBe(
      'draft.draft'
    );
    expect(
      renamedEntityName('Launch notes', 'replace', '', 'spec', 'plan')
    ).toBe('Launch notes');
  });
  it('preserves existing replaceAll behavior when Find is empty', () => {
    expect(renamedEntityName('ab', 'replace', '', '', '-')).toBe('-a-b-');
  });
  it('supports removing matched text and replacing the entire name', () => {
    expect(
      renamedEntityName('Draft: Launch', 'replace', '', 'Draft: ', '')
    ).toBe('Launch');
    expect(
      renamedEntityName(
        'Launch notes',
        'total',
        'New title',
        'ignored',
        'ignored'
      )
    ).toBe('New title');
  });
});
