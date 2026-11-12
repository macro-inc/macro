import { describe, expect, it, vi } from 'vitest';
import { openAgentsPage } from './open-page';

describe('openAgentsPage', () => {
  it('opens routines using durable list and detail routes', () => {
    const openWithSplit = vi.fn(() => ({ status: 'navigating' as const }));
    openAgentsPage({ openWithSplit }, 'routines');
    openAgentsPage({ openWithSplit }, 'routines', { routineId: 'routine-1' });
    expect(openWithSplit.mock.calls).toMatchObject([
      [
        {
          id: 'routines',
          entryMetadata: {
            route: { matches: [{ id: 'app' }, { id: 'view-routines' }] },
          },
        },
        { activate: true, search: {} },
      ],
      [
        {
          id: 'routines',
          entryMetadata: {
            route: {
              matches: [
                { id: 'app' },
                { id: 'routine-detail', params: { routineId: 'routine-1' } },
              ],
            },
          },
        },
        { activate: true, search: {} },
      ],
    ]);
  });

  it.each(['connections', 'artifacts'] as const)(
    'opens %s as its own destination without an imperative page request',
    (page) => {
      const openWithSplit = vi.fn(() => ({ status: 'navigating' as const }));
      openAgentsPage({ openWithSplit }, page);
      expect(openWithSplit).toHaveBeenCalledWith(
        { type: 'component', id: page, params: {} },
        { activate: true, search: {} }
      );
    }
  );

  it('allows navigation to be intercepted', () => {
    expect(() =>
      openAgentsPage(
        { openWithSplit: () => ({ status: 'unavailable' }) },
        'connections'
      )
    ).not.toThrow();
  });
});
