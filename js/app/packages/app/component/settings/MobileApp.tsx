import AppStoreQr from '@design/app-store.svg';
import { SettingsCard, SettingsPage } from './primitives';

export function MobileApp() {
  return (
    <SettingsPage
      title="Mobile app"
      description="Scan the code to get Macro on your phone."
    >
      <SettingsCard>
        <div class="flex flex-col items-center justify-center gap-6 py-12">
          <AppStoreQr style="display: block; max-width: 280px;" />
          <p class="text-sm text-ink text-center">
            Download on the
            <br />
            <a
              href="https://apps.apple.com/us/app/macro-app/id6743133649"
              rel="noopener noreferrer"
              class="text-accent hover:underline"
              target="_blank"
            >
              App Store
            </a>
          </p>
        </div>
      </SettingsCard>
    </SettingsPage>
  );
}
