import { describe, expect, it } from 'vitest';
import {
  JOURNEY_STORAGE_KEY,
  readJourney,
  saveJourney,
} from './journeyProgress';

function storage(initial: string | null = null) {
  let saved = initial;
  return {
    getItem: (_key: string) => saved,
    setItem: (key: string, value: string) => {
      expect(key).toBe(JOURNEY_STORAGE_KEY);
      saved = value;
    },
  };
}

describe('public journey progress', () => {
  it('restores the current step and tool edits after leaving and re-entering', () => {
    const store = storage();
    saveJourney(store, {
      step: 2,
      tools: ['Google', 'Slack'],
      search: 'slack',
    });
    saveJourney(store, { tour: 4 });
    expect(readJourney(store)).toEqual({
      step: 2,
      tools: ['Google', 'Slack'],
      search: 'slack',
      tour: 4,
    });
  });
  it('preserves a deliberately empty selection', () => {
    const store = storage();
    saveJourney(store, { tools: [] });
    expect(readJourney(store).tools).toEqual([]);
  });
  it('recovers from corrupt and obsolete data', () => {
    expect(readJourney(storage('{broken')).step).toBe(0);
    expect(
      readJourney(
        storage(
          JSON.stringify({
            step: 200,
            tools: [null, 'Slack'],
            search: 42,
            tour: -1,
          })
        )
      )
    ).toEqual({ step: 0, tools: ['Slack'], search: '', tour: 0 });
  });
  it('keeps working when browser storage is unavailable', () => {
    const unavailable = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    expect(saveJourney(unavailable, { step: 2 }).step).toBe(2);
  });
});
