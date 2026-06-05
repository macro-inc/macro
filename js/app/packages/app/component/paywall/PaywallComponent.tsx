import type { PaywallKey } from '@core/constant/PaywallState';
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
  <PaywallComponentNew {...props} />
);

export default PaywallComponent;
