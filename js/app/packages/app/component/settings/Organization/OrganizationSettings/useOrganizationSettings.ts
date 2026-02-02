import { createSingletonRoot } from '@solid-primitives/rootless';
import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';

interface IOrganizationSettings {
  name: string;
  default_share_permission: string;
  retention_days?: number;
}

const useOrganizationSettings = createSingletonRoot(() => {
  const [loading] = createSignal(false);
  const [store] = createStore<IOrganizationSettings>({
    name: '',
    default_share_permission: 'public',
  });

  const changeRetentionDays = async (_e: Event) => {
    // Organization service has been removed
  };

  const updateRetentionDays = async (_days: number) => {
    // Organization service has been removed
  };

  const removeRetentionDays = async () => {
    // Organization service has been removed
  };

  return {
    orgSettings: store,
    loading,
    changeRetentionDays,
    updateRetentionDays,
    removeRetentionDays,
  };
});

export default useOrganizationSettings;
