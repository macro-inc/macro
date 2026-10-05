import type { Accessor } from 'solid-js';
import type { AutoReloadSettings, UsageSummary } from '../core/usage';

/** Capabilities supplied by the app; views can also be mounted with test sources. */
export type UsageContext = {
  available: Accessor<boolean>;
  summary: Accessor<UsageSummary | undefined>;
  loading: Accessor<boolean>;
  failed: Accessor<boolean>;
  refresh: () => void;
  checkout: {
    pending: Accessor<boolean>;
    supportedAmounts: Accessor<readonly number[]>;
    start: (amountCents: number) => Promise<string>;
  };
  autoReload: {
    settings: Accessor<AutoReloadSettings>;
    available: Accessor<boolean>;
    pending: Accessor<boolean>;
    save: (settings: AutoReloadSettings) => Promise<void>;
    preview: Accessor<boolean>;
  };
  paymentMethods: {
    pending: Accessor<boolean>;
    open: () => Promise<string>;
  };
  existingUsageBilling: {
    pending: Accessor<boolean>;
    turnOff: () => Promise<void>;
  };
  navigateToPayment: (url: string) => void;
  openPlans: () => void;
  developer?: {
    exhausted: Accessor<boolean>;
    simulateExhausted: () => void;
    openLimitDialog: () => void;
    previewAutoReload: () => void;
    reset: () => void;
  };
};
