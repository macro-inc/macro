import { describe, expect, it } from 'vitest';
import { loadableQuery } from './loadable-query';

describe('onboarding query sources', () => {
  it('never reads pending data, including disabled and paused queries', () => {
    const query = {
      isPending: true,
      isError: false,
      get data(): string | undefined {
        throw new Error('A pending resource read would suspend onboarding');
      },
    };
    expect(loadableQuery(query, (value) => value)).toEqual({ t: 'loading' });
  });

  it('keeps loaded data available after a failed background refetch', () => {
    expect(
      loadableQuery(
        {
          isPending: false,
          isError: true,
          data: ['teammate@example.com'],
        },
        (data) => data
      )
    ).toEqual({ t: 'ready', value: ['teammate@example.com'] });
  });

  it('reports a failed first load without inventing data', () => {
    expect(
      loadableQuery(
        { isPending: false, isError: true, data: undefined },
        (data) => data
      )
    ).toEqual({ t: 'error' });
  });

  it('treats a loaded null offer as ready', () => {
    expect(
      loadableQuery(
        { isPending: false, isError: false, data: null },
        (data) => data
      )
    ).toEqual({ t: 'ready', value: null });
  });
});
