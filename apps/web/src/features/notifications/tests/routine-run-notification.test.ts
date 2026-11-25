import { describe, expect, it } from 'vitest';
import { routineRunText } from '../notification-metadata';

describe('routineRunText', () => {
  it('says a run finished or failed', () => {
    expect(routineRunText({ outcome: 'succeeded' })).toBe('Its run finished.');
    expect(routineRunText({ outcome: 'failed' })).toBe('Its run failed.');
    expect(routineRunText({ outcome: 'failed', appsToConnect: [] })).toBe(
      'Its run failed.'
    );
  });

  it('names the apps a run refused for a disconnected app needs', () => {
    expect(
      routineRunText({ outcome: 'failed', appsToConnect: ['Linear'] })
    ).toBe('It needs Linear connected to run. Reconnect it.');
    expect(
      routineRunText({
        outcome: 'failed',
        appsToConnect: ['Linear', 'Notion', 'Slack'],
      })
    ).toBe(
      'It needs Linear, Notion and Slack connected to run. Reconnect them.'
    );
  });
});
