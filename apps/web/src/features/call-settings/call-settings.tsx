import { createAppCallSettings } from './call-settings-adapter';
import { CallSettingsProvider } from './context/call-settings-context';
import { CallSettingsView } from './views/call-settings-view';

/** The Calls settings page, wired to the call service. */
export function CallSettings() {
  return (
    <CallSettingsProvider value={createAppCallSettings()}>
      <CallSettingsView />
    </CallSettingsProvider>
  );
}
