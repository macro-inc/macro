import { describe, expect, it } from 'vitest';
import { canLabelChannel } from './channel-label-eligibility';

describe('channel label eligibility', () => {
  it('requires a known team channel', () => {
    expect(canLabelChannel({ channelType: 'team' })).toBe(true);
    expect(canLabelChannel({ channelType: 'public' })).toBe(false);
    expect(canLabelChannel({ channelType: 'private' })).toBe(false);
    expect(canLabelChannel({ channelType: 'direct_message' })).toBe(false);
    expect(canLabelChannel(undefined)).toBe(false);
  });
});
