import { expect, it } from 'vitest';
import { groupError } from './group';

it('gives group setup instructions without exposing raw provider errors or reply wording', () => {
  for (const code of [
    '131204',
    'provider_rejected',
    undefined,
    'sensitive provider body',
  ]) {
    const copy = groupError(code);
    expect(copy).toContain('group setup');
    expect(copy).not.toMatch(/reply|draft|131204|sensitive/);
  }
  expect(groupError('group_ineligible')).toContain('webhook setup');
  expect(groupError('group_unconfirmed')).toContain('existing setup');
});
