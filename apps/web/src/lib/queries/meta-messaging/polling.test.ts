import { describe, expect, it } from 'vitest';
import { bindingRetryInterval, deliveryPollInterval } from './polling';

const now = Date.parse('2026-10-12T05:00:00Z');
const at = (age: number) => new Date(now - age).toISOString();

describe('delivery polling', () => {
  it('follows newly queued sends and backs off after acceptance and delivery', () => {
    expect(
      deliveryPollInterval([{ state: 'pending', created_at: at(0) }], now)
    ).toBe(2000);
    expect(
      deliveryPollInterval([{ state: 'accepted', created_at: at(30_000) }], now)
    ).toBe(2000);
    expect(
      deliveryPollInterval(
        [{ state: 'delivered', created_at: at(30_000) }],
        now
      )
    ).toBe(10000);
  });
  it('stops fast polling for old or settled sends, including ambiguous outcomes', () => {
    for (const state of ['read', 'failed', 'unknown'] as const) {
      expect(deliveryPollInterval([{ state, created_at: at(0) }], now)).toBe(
        false
      );
    }
    for (const state of ['accepted', 'sent', 'delivered'] as const) {
      expect(
        deliveryPollInterval([{ state, created_at: at(60_000) }], now)
      ).toBe(false);
    }
    expect(
      deliveryPollInterval([{ state: 'sending', created_at: at(300_000) }], now)
    ).toBe(false);
    expect(deliveryPollInterval([], now)).toBe(false);
  });
  it('a new send resumes fast polling in a conversation full of old receipts', () => {
    expect(
      deliveryPollInterval(
        [
          { state: 'delivered', created_at: at(86400_000) },
          { state: 'pending', created_at: at(0) },
        ],
        now
      )
    ).toBe(2000);
  });
});

describe('binding lookup retry', () => {
  it('backs off from two seconds to a thirty-second ceiling', () => {
    expect([1, 2, 3, 4, 5, 9].map(bindingRetryInterval)).toEqual([
      2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });
});
