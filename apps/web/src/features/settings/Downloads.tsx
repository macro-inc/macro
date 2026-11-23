import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { t } from '@app/lib/i18n';
import { storeListingUrl } from '@core/mobile/native-update-link';
import { isPlatform } from '@core/util/platform';
import { useCopyLink } from '@core/util/useCopyLink';
import AppStoreQr from '@design/app-store.svg';
import PlayStoreQr from '@design/play-store.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import { buttonClasses, CopyButton, Tabs } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  DESKTOP_DOWNLOAD_URLS,
  DESKTOP_PLATFORMS,
  type DesktopPlatform,
  detectDesktopPlatform,
} from './core/desktop-downloads';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './primitives';

const STORES = {
  ios: {
    device: 'iPhone',
    name: 'App Store',
    get prompt() {
      return t('settingsDownloads.appStorePrompt');
    },
    qr: AppStoreQr,
  },
  android: {
    device: 'Android',
    name: 'Google Play',
    get prompt() {
      return t('settingsDownloads.googlePlayPrompt');
    },
    qr: PlayStoreQr,
  },
};

type Store = keyof typeof STORES;

const STORE_TABS = (['ios', 'android'] as const).map((value) => ({
  value,
  label: STORES[value].device,
}));

const DOWNLOAD_LABELS: Record<DesktopPlatform, () => string> = {
  macos: () => t('settingsDownloads.downloadForMacos'),
  linux: () => t('settingsDownloads.downloadForLinux'),
};

/**
 * The desktop installer for this computer and the phone app's QR codes. The
 * desktop app itself gets only the QR codes; phones and the mobile apps have
 * no Downloads page.
 */
export function Downloads() {
  const inDesktopApp = isPlatform('desktop');

  return (
    <SettingsPage
      title={t('settingsDownloads.title')}
      description={
        inDesktopApp
          ? t('settingsDownloads.descriptionInDesktopApp')
          : t('settingsDownloads.description')
      }
    >
      <Show when={!inDesktopApp}>
        <DesktopDownload />
      </Show>
      <SettingsSection
        title={t('settingsDownloads.mobileTitle')}
        target="Mobile app"
        description={t('settingsDownloads.scanDescription')}
      >
        <SettingsCard>
          <StoreQrCode />
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}

/** What the leading installer needs, or where installers exist at all. */
function requirement(platform: DesktopPlatform | undefined): string {
  if (platform === 'macos') return t('settingsDownloads.macosRequirement');
  if (platform === 'linux') return t('settingsDownloads.linuxRequirement');
  return t('settingsDownloads.desktopPlatforms');
}

/**
 * The detected platform's installer leads; the other is a secondary choice.
 * A computer Macro has no installer for (Windows, ChromeOS) gets both as
 * equals.
 */
function DesktopDownload() {
  const analytics = useAnalytics();
  const detected = detectDesktopPlatform(navigator.userAgent);

  const platforms = detected
    ? [detected, ...DESKTOP_PLATFORMS.filter((p) => p !== detected)]
    : DESKTOP_PLATFORMS;

  return (
    <SettingsSection
      title={t('settingsDownloads.desktopTitle')}
      target="Desktop app"
    >
      <SettingsCard>
        <SettingsRow
          label={t('settingsDownloads.desktopDownload')}
          description={requirement(detected)}
          stackOnNarrow
        >
          <div class="flex flex-wrap gap-2">
            <For each={platforms}>
              {(platform) => (
                <a
                  href={DESKTOP_DOWNLOAD_URLS[platform]}
                  class={buttonClasses({
                    variant: platform === detected ? 'primary' : 'secondary',
                    size: 'md',
                  })}
                  onClick={() =>
                    analytics.track('desktop_download_clicked', {
                      platform,
                      source: 'app_settings',
                    })
                  }
                >
                  {DOWNLOAD_LABELS[platform]()}
                </a>
              )}
            </For>
          </div>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}

function StoreQrCode() {
  const copy = useCopyLink();
  const [store, setStore] = createSignal<Store>('ios');
  const current = () => STORES[store()];

  return (
    <div class="flex flex-col items-center gap-6 px-6 pt-10 pb-12">
      <Tabs
        aria-label={t('settingsDownloads.phone')}
        options={STORE_TABS}
        value={store()}
        onChange={setStore}
      />
      <Dynamic component={current().qr} class="block w-60" />
      <p class="min-h-10 max-w-44 text-sm text-ink text-center">
        {current().prompt}
      </p>
      <CopyButton
        aria-label={t('settingsDownloads.copyStoreLink', {
          store: current().name,
        })}
        variant="ghost"
        size="sm"
        tooltip={t('settingsDownloads.copyStoreLink', {
          store: current().name,
        })}
        onClick={() => copy(storeListingUrl(store()))}
        icon={<LinkIcon class="size-3.5" />}
      >
        {t('settingsDownloads.copyLink')}
      </CopyButton>
    </div>
  );
}
