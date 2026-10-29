import type { Accessor } from 'solid-js';
import type {
  AutoReloadBudget,
  AutoReloadSettings,
  UsagePreviewPlan,
  UsageSummary,
} from '../core/usage';

/** Capabilities supplied by the app; views can also be mounted with test sources. */
export type UsageContext = {
  available: Accessor<boolean>;
  summary: Accessor<UsageSummary | undefined>;
  loading: Accessor<boolean>;
  failed: Accessor<boolean>;
  refresh: () => void;
  /** One-time credit purchases charged to the card on file (the team owner's
   * for a member). Resolves to how the charge ended; rejects when refused.
   * When the card can't be charged off-session (none on file, or it needs
   * 3-D Secure) nothing is charged and the payer can `checkout`. */
  creditPurchase: {
    pending: Accessor<boolean>;
    supportedAmounts: Accessor<readonly number[]>;
    buy: (
      amountCents: number
    ) => Promise<
      | 'paid'
      | 'declined'
      | 'payment_method_required'
      | 'authentication_required'
    >;
    /** Stripe Checkout for the same pack; resolves to its URL. Payer only. */
    checkout: (amountCents: number) => Promise<string>;
  };
  autoReload: {
    settings: Accessor<AutoReloadSettings>;
    /** Authoritative calendar-month cap commitments, or explicit lab fixtures. */
    budget?: Accessor<AutoReloadBudget | undefined>;
    available: Accessor<boolean>;
    pending: Accessor<boolean>;
    /** The last automatic reload failed to charge; saving retries. */
    suspended: Accessor<boolean>;
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
    openBillingLab?: () => void;
    active: Accessor<boolean>;
    plan: Accessor<UsagePreviewPlan | undefined>;
    beforeLaunch: Accessor<boolean>;
    previewPlan: (plan: UsagePreviewPlan) => void;
    openLimitDialog: (plan: UsagePreviewPlan) => void;
    previewBeforeLaunch: () => void;
    reset: () => void;
  };
};
