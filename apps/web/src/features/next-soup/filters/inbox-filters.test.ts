import type { EntityData } from '@entity';
import { describe, expect, it } from 'vitest';
import { isSpamEmail, noiseFilter } from './inbox-filters';

type EmailEntity = Extract<EntityData, { type: 'email' }>;

const email = (labels: string[]): EmailEntity =>
  ({
    type: 'email',
    id: 'thread-1',
    labels: labels.map((name) => ({
      id: `label-${name}`,
      providerLabelId: name,
      name,
    })),
  }) as unknown as EmailEntity;

describe('isSpamEmail', () => {
  it('matches the provider SPAM label by id, provider id, or name', () => {
    expect(isSpamEmail(email(['SPAM']))).toBe(true);
    expect(isSpamEmail(email(['INBOX', 'CATEGORY_PROMOTIONS']))).toBe(false);
    expect(isSpamEmail(email([]))).toBe(false);
  });

  it('keeps spam in the noise bucket', () => {
    // Spam threads are shown rather than hidden, and never as signal, so the
    // client-side noise filter must accept them whatever else they carry.
    expect(noiseFilter(email(['SPAM', 'CATEGORY_PERSONAL']))).toBe(true);
  });
});
