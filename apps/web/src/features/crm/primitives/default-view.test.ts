import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { CrmViewConfig } from '../core/saved-view';
import { createDefaultCrmView } from './default-view';

const config: CrmViewConfig = {
  kind: 'crm',
  viewMode: 'board',
  searchText: 'Acme',
};

describe('default CRM view', () => {
  it.each([true, false])(
    'retains filters and uses the correct layout on mobile=%s',
    (mobile) => {
      const apply = vi.fn();
      const dispose = createRoot((dispose) => {
        createDefaultCrmView({
          personalLoading: () => false,
          teamLoading: () => false,
          personal: () => config,
          team: () => undefined,
          mobile: () => mobile,
          apply,
        });
        return dispose;
      });
      expect(apply).toHaveBeenCalledWith({
        ...config,
        viewMode: mobile ? 'list' : 'board',
      });
      expect(config.viewMode).toBe('board');
      dispose();
    }
  );
  it('waits for both sources, prefers personal, and never reapplies on refetch', () => {
    const apply = vi.fn();
    const [loading, setLoading] = createSignal(true);
    const [personal, setPersonal] = createSignal<CrmViewConfig | undefined>();
    const dispose = createRoot((dispose) => {
      createDefaultCrmView({
        personalLoading: loading,
        teamLoading: () => false,
        personal,
        team: () => ({ kind: 'crm', searchText: 'team' }),
        mobile: () => false,
        apply,
      });
      return dispose;
    });
    expect(apply).not.toHaveBeenCalled();
    setPersonal(config);
    setLoading(false);
    expect(apply).toHaveBeenCalledExactlyOnceWith(config);
    setPersonal({ ...config, searchText: 'changed' });
    expect(apply).toHaveBeenCalledTimes(1);
    dispose();
  });
  it('falls back to the team default', () => {
    const apply = vi.fn();
    const dispose = createRoot((dispose) => {
      createDefaultCrmView({
        personalLoading: () => false,
        teamLoading: () => false,
        personal: () => undefined,
        team: () => config,
        mobile: () => false,
        apply,
      });
      return dispose;
    });
    expect(apply).toHaveBeenCalledExactlyOnceWith(config);
    dispose();
  });
});
