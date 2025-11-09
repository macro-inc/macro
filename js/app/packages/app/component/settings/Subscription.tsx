import { useSettingsState } from '@core/constant/SettingsState';
import PaywallComponent from '../paywall/PaywallComponent';

export const Subscription = () => {
  const { toggleSettings } = useSettingsState();
  return (
    <PaywallComponent
      hideCloseButton
      cb={() => {}}
      handleGuest={() => toggleSettings()}
    />
  );
};
