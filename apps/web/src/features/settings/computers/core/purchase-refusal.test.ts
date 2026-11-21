import { ThrownResultError } from '@core/util/result';
import { describe, expect, it } from 'vitest';
import { purchaseRefusalOf } from './purchase-refusal';

const refused = (code: string) =>
  purchaseRefusalOf(new ThrownResultError([{ code, message: code }]));

describe('purchaseRefusalOf', () => {
  it('passes through the refusals the buy and add-agent dialogs share', () => {
    expect(refused('PAYMENT_DECLINED')).toBe('PAYMENT_DECLINED');
    expect(refused('NO_ROOM')).toBe('NO_ROOM');
    expect(refused('TEAM_ON_TRIAL')).toBe('TEAM_ON_TRIAL');
    expect(refused('INVITE_IN_PROGRESS')).toBe('INVITE_IN_PROGRESS');
  });

  it('leaves every other failure to the caller', () => {
    expect(refused('PURCHASE_CONFLICT')).toBeUndefined();
    expect(purchaseRefusalOf(new Error('network'))).toBeUndefined();
  });
});
