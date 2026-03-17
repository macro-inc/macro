import { describe, expect, it } from 'vitest';
import { parseDebugTargetInput } from '../DebugGoToMessage';

describe('parseDebugTargetInput', () => {
  it('returns the raw trimmed value when given a message id', () => {
    expect(parseDebugTargetInput('  message-123  ')).toBe('message-123');
  });

  it('extracts targetMessageId from a copied payload', () => {
    expect(
      parseDebugTargetInput('{"targetMessageId":"message-456"}')
    ).toBe('message-456');
  });

  it('returns undefined for invalid json input that looks like a payload', () => {
    expect(parseDebugTargetInput('{invalid json')).toBeUndefined();
  });

  it('returns undefined when the payload is missing a usable targetMessageId', () => {
    expect(parseDebugTargetInput('{"targetMessageId":""}')).toBeUndefined();
    expect(parseDebugTargetInput('{"threadId":"reply-1"}')).toBeUndefined();
  });
});
