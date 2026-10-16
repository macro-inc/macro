import AppStoreQr from '@design/app-store.svg';
import { SettingsCard, SettingsPage } from './primitives';

export function MobileApp() {
  return (
    <SettingsPage
      title="Mobile app (Alpha)"
      description="Scan the code to get Macro Alpha on your phone."
    >
      <SettingsCard>
        <div class="flex flex-col items-center justify-center gap-6 py-12">
          <AppStoreQr style="display: block; max-width: 280px;" />
          <p class="text-sm text-ink text-center">
            Download Macro Alpha on the
            <br />
            App Store
          </p>
        </div>
      </SettingsCard>
    </SettingsPage>
  );
}
