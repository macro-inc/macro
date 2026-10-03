import { describe, expect, it } from 'vitest';
import {
  type SequenceContentOptions,
  sequenceContentId,
} from './content-identity';

const options: SequenceContentOptions = {
  databaseId: 'database',
  campaignId: 'campaign',
  stepId: 'welcome',
  field: 'body',
  initialText: 'Hello',
};
describe('collaborative sequence content identity', () => {
  it('retains the shared document identity when text or timing snapshots change', () => {
    expect(
      sequenceContentId({ ...options, initialText: 'Updated elsewhere' })
    ).toBe(sequenceContentId(options));
    expect(sequenceContentId(options)).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/
    );
  });
  it('isolates databases, campaigns, steps, and subject/body documents', () => {
    const identities = [
      options,
      { ...options, databaseId: 'other' },
      { ...options, campaignId: 'other' },
      { ...options, stepId: 'other' },
      { ...options, field: 'subject' as const },
    ].map(sequenceContentId);
    expect(new Set(identities).size).toBe(identities.length);
  });
  it('does not collide when imported IDs contain separators', () => {
    expect(
      sequenceContentId({ ...options, campaignId: 'a:b', stepId: 'c' })
    ).not.toBe(
      sequenceContentId({ ...options, campaignId: 'a', stepId: 'b:c' })
    );
  });
});
