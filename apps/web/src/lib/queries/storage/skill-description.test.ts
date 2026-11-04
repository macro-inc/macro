import { describe, expect, it } from 'vitest';
import { skillDescriptionProblem } from './skill-description';

describe('skillDescriptionProblem', () => {
  it('accepts one "Use when" line, whatever its case', () => {
    expect(
      skillDescriptionProblem(
        '  Use when drafting release notes; not changelogs  '
      )
    ).toBeUndefined();
    expect(skillDescriptionProblem('use when triaging bugs')).toBeUndefined();
  });

  it('rejects blank, multi-line, long or unprefixed descriptions', () => {
    for (const invalid of [
      '',
      '   ',
      'Use when one\nand two',
      'Drafts release notes',
      `Use when ${'x'.repeat(300)}`,
    ]) {
      expect(skillDescriptionProblem(invalid)).toBeDefined();
    }
  });
});
