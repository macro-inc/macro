import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { Dashboard, DashboardFailure } from '../core/dashboard';
import { dashboard } from '../tests/fake-dashboard';
import { createDashboardView } from './dashboard-view';

function fakeSource() {
  const [current, setDashboard] = createSignal<Dashboard>();
  const [failure, setFailure] = createSignal<DashboardFailure>();
  return { dashboard: current, failure, setDashboard, setFailure };
}

describe('createDashboardView', () => {
  it('loads, then shows the dashboard', () => {
    createRoot((dispose) => {
      const source = fakeSource();
      const view = createDashboardView(source);
      expect(view()).toEqual({ t: 'loading' });

      const loaded = dashboard();
      source.setDashboard(loaded);
      expect(view()).toEqual({ t: 'ready', dashboard: loaded });
      dispose();
    });
  });

  it('keeps a loaded dashboard through a failed refresh', () => {
    createRoot((dispose) => {
      const source = fakeSource();
      const view = createDashboardView(source);
      source.setDashboard(dashboard());
      source.setFailure('failed');
      expect(view().t).toBe('ready');
      dispose();
    });
  });

  it('reads a missing dashboard, and one without panes, as empty', () => {
    createRoot((dispose) => {
      const source = fakeSource();
      const view = createDashboardView(source);
      source.setFailure('missing');
      expect(view()).toEqual({ t: 'empty' });

      source.setFailure(undefined);
      source.setDashboard(dashboard({ view: { widgets: [] } }));
      expect(view()).toEqual({ t: 'empty' });
      dispose();
    });
  });

  it('tells no access apart from a failure', () => {
    createRoot((dispose) => {
      const source = fakeSource();
      const view = createDashboardView(source);
      source.setFailure('forbidden');
      expect(view()).toEqual({ t: 'noAccess' });

      source.setFailure('failed');
      expect(view()).toEqual({ t: 'error' });
      dispose();
    });
  });
});
