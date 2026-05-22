import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { ENABLE_SIMPLIFIED_PRICING_OVERRIDE } from '@core/constant/featureFlags';
import type { PaywallKey } from '@core/constant/PaywallState';
import PaywallComponentLegacy from './PaywallComponentLegacy';
import PaywallComponentSimplified from './PaywallComponentSimplified';

export interface PaywallProps {
  cb: () => Promise<void> | void;
  handleGuest?: () => void;
  isOnboarding?: boolean;
  errorKey?: PaywallKey | null;
  customType?: string;
  hideCloseButton?: boolean;
}

const PaywallComponent = (props: PaywallProps) => (
  <ShowFeatureFlag
    key="enable-simplified-pricing"
    enabledOverride={ENABLE_SIMPLIFIED_PRICING_OVERRIDE}
    fallback={<PaywallComponentLegacy {...props} />}
  >
    <PaywallComponentSimplified {...props} />
  </ShowFeatureFlag>
);

export default PaywallComponent;
