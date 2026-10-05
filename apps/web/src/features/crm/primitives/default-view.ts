import { type Accessor, createEffect } from 'solid-js';
import type { CrmViewConfig } from '../core/saved-view';

export function createDefaultCrmView(input: {
  personalLoading: Accessor<boolean>;
  teamLoading: Accessor<boolean>;
  personal: Accessor<CrmViewConfig | undefined>;
  team: Accessor<CrmViewConfig | undefined>;
  mobile: Accessor<boolean>;
  apply(config: CrmViewConfig): void;
}) {
  let applied = false;
  // Synchronize asynchronously loaded preferences into the live workspace once.
  createEffect(() => {
    if (applied || input.personalLoading() || input.teamLoading()) return;
    applied = true;
    const config = input.personal() ?? input.team();
    if (config)
      input.apply(input.mobile() ? { ...config, viewMode: 'list' } : config);
  });
}
