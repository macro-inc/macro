import { useCopyLink } from '@core/util/useCopyLink';
import AppStoreQr from '@design/app-store.svg';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import LinkIcon from '@phosphor/link.svg';
import { CopyButton } from '@ui';
import { SettingsCard, SettingsPage } from './primitives';

const APP_STORE_URL = 'https://apps.apple.com/us/app/macro-app/id6743133649';

export function MobileApp() {
  const copy = useCopyLink();

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
              variant="ghost"
              size="sm"
              label="Copy App Store link"
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
