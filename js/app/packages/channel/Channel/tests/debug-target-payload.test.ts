import { describe, expect, it } from 'vitest';
import { buildTargetMessagePayload } from '../create-channel-message-actions';

describe('buildTargetMessagePayload', () => {
  it('serializes the top-level target message id', () => {
    expect(buildTargetMessagePayload('message-123')).toBe(
      '{"targetMessageId":"message-123"}'
    );
  });
});
