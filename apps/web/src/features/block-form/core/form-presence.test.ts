import { describe, expect, it } from 'vitest';
import { isFormSelection } from './form-presence';

describe('isFormSelection', () => {
  it('accepts a selected question and a selected section', () => {
    expect(
      isFormSelection({
        sectionId: '0192f3a0-0000-7000-8000-000000000001',
        questionId: '0192f3a0-0000-7000-8000-000000000002',
      })
    ).toBe(true);
    expect(
      isFormSelection({
        sectionId: '0192f3a0-0000-7000-8000-000000000001',
        questionId: null,
      })
    ).toBe(true);
  });

  it('refuses what another client might publish', () => {
    expect(isFormSelection(undefined)).toBe(false);
    expect(isFormSelection(null)).toBe(false);
    expect(isFormSelection('section')).toBe(false);
    expect(isFormSelection({ sectionId: '', questionId: null })).toBe(false);
    expect(isFormSelection({ sectionId: 7, questionId: null })).toBe(false);
    expect(
      isFormSelection({
        sectionId: '0192f3a0-0000-7000-8000-000000000001',
        questionId: 7,
      })
    ).toBe(false);
    expect(
      isFormSelection({ sectionId: '0192f3a0-0000-7000-8000-000000000001' })
    ).toBe(false);
  });
});
