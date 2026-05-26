import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { ENABLE_NEW_PRICING_OVERRIDE } from '@core/constant/featureFlags';
import type { PaywallKey } from '@core/constant/PaywallState';
import PaywallComponentLegacy from './PaywallComponentLegacy';
import PaywallComponentNew from './PaywallComponentNew';

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
    key="enable-new-pricing"
    enabledOverride={ENABLE_NEW_PRICING_OVERRIDE}
    fallback={<PaywallComponentLegacy {...props} />}
  >
    <PaywallComponentNew {...props} />
  </ShowFeatureFlag>
);

export default PaywallComponent;
