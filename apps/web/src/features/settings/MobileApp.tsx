import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { useCopyLink } from '@core/util/useCopyLink';
import AppStoreQr from '@design/app-store.svg';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import { CopyButton } from '@ui';
import { NativeAppInfo } from './NativeAppInfo';
import { SettingsCard, SettingsPage } from './primitives';

const APP_STORE_URL = 'https://apps.apple.com/us/app/macro-app/id6743133649';

/** Native APIs are only read when mounted inside the mobile app. */
export function MobileApp() {
  if (isNativeMobilePlatform()) {
    return (
      <NativeAppInfo
        title="Mobile app"
        description="Your installed version of Macro."
      />
    );
  }
  const copy = useCopyLink();

  return (
    <SettingsPage
      title="Mobile app"
      description="Scan the code to get Macro on your phone."
    >
      <SettingsCard>
        <div class="flex flex-col items-center justify-center gap-6 py-12">
          <AppStoreQr style="display: block; max-width: 280px;" />
          <p class="text-sm text-ink text-center">
            Download Macro on the
            <br />
            App Store
          </p>
          <div class="flex items-center gap-2">
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm font-medium text-ink-muted hover:bg-ink/4 hover:text-ink transition-colors"
            >
              Open in App Store
              <ArrowUpRightIcon class="size-3.5 opacity-70" />
            </a>
            <CopyButton
              aria-label="Copy App Store link"
              variant="ghost"
              size="sm"
              tooltip="Copy App Store link"
              onClick={() => copy(APP_STORE_URL)}
            >
              <LinkIcon class="size-3.5" />
              Copy link
            </CopyButton>
          </div>
        </div>
      </SettingsCard>
    </SettingsPage>
  );
}
