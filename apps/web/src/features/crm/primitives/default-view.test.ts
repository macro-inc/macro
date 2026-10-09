import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { CrmViewConfig } from '../core/saved-view';
import { createDefaultCrmView } from './default-view';

const config: CrmViewConfig = {
  kind: 'crm',
  searchText: 'Acme',
};

describe('default CRM view', () => {
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
        apply,
      });
      return dispose;
    });
    expect(apply).toHaveBeenCalledExactlyOnceWith(config);
    dispose();
  });
});
