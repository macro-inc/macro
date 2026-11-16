import { describe, expect, it } from 'vitest';
import { patchedEvent } from '../optimistic';
import { graphqlEvent } from './fixtures';

describe('optimistic event visibility', () => {
  it('patches only the addressed copy when it is not canonical', () => {
    const original = graphqlEvent();
    const next = patchedEvent(original, { visibility: 'public' }, 'calendar-2');
    expect(next.visibility).toBe('DEFAULT');
    expect(next.sources[0]?.visibility).toBe('DEFAULT');
    expect(next.sources[1]?.visibility).toBe('PUBLIC');
    expect(original.sources[1]?.visibility).toBe('PRIVATE');
  });

  it('patches canonical visibility and supports resetting it to default', () => {
    const original = graphqlEvent();
    const privateEvent = patchedEvent(
      original,
      { visibility: 'private' },
      'calendar-1'
    );
    expect(privateEvent.visibility).toBe('PRIVATE');
    expect(privateEvent.sources[0]?.visibility).toBe('PRIVATE');
    const reset = patchedEvent(
      privateEvent,
      { visibility: 'default' },
      'calendar-1'
    );
    expect(reset.visibility).toBe('DEFAULT');
    expect(reset.sources[0]?.visibility).toBe('DEFAULT');
    expect(privateEvent.visibility).toBe('PRIVATE');
  });
});
