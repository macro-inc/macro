import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { t } from '@app/lib/i18n';
import { storeListingUrl } from '@core/mobile/native-update-link';
import { fireAndForget } from '@core/util/fireAndForget';
import { isPlatform } from '@core/util/platform';
import { useCopyLink } from '@core/util/useCopyLink';
import AppStoreQr from '@design/app-store.svg';
import PlayStoreQr from '@design/play-store.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import { buttonClasses, CopyButton, Tabs } from '@ui';
import { createSignal, For, onMount, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import {
  DESKTOP_DOWNLOAD_URLS,
  type DesktopPlatform,
  desktopInstallers,
  detectDesktopPlatform,
  intelMacPublished,
  type MacArchitecture,
  readMacArchitecture,
  type UserAgentData,
} from './core/desktop-downloads';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './primitives';

// The website's /download page has copies of these QR codes
// (apps/marketing/src/assets/mobile-qr); change both together.
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

/**
 * Beside the Intel installer, the Mac one names its chip too, and off a Mac
 * both also say they are for a Mac.
 */
function downloadLabel(
  platform: DesktopPlatform,
  intel: boolean,
  onMac: boolean
): string {
  return match(platform)
    .with('linux', () => t('settingsDownloads.downloadForLinux'))
    .with('macos', () => {
      if (!intel) return t('settingsDownloads.downloadForMacos');
      return onMac
        ? t('settingsDownloads.downloadForAppleSilicon')
        : t('settingsDownloads.downloadForMacAppleSilicon');
    })
    .with('macos-intel', () =>
      onMac
        ? t('settingsDownloads.downloadForIntelMac')
        : t('settingsDownloads.downloadForMacIntel')
    )
    .exhaustive();
}

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

/**
 * What the leading installer needs, or where installers exist at all. A Mac
 * whose chip is still unknown gets the requirement both Mac installers share.
 */
function requirement(
  platform: DesktopPlatform | undefined,
  chipKnown: boolean
): string {
  return match(platform)
    .with('macos', () =>
      chipKnown
        ? t('settingsDownloads.macosRequirement')
        : t('settingsDownloads.macosAnyChipRequirement')
    )
    .with('macos-intel', () => t('settingsDownloads.macosIntelRequirement'))
    .with('linux', () => t('settingsDownloads.linuxRequirement'))
    .with(undefined, () => t('settingsDownloads.desktopPlatforms'))
    .exhaustive();
}

/** Chromium's answer to which processor this Mac has; others give none. */
async function loadMacArchitecture(
  set: (architecture: MacArchitecture | undefined) => void
) {
  const browser = navigator as Navigator & { userAgentData?: UserAgentData };
  set(await readMacArchitecture(browser.userAgentData));
}

/**
 * The detected platform's installer leads; the others are secondary choices.
 * On a Mac, once the Intel installer is published, Apple silicon and Intel
 * sit side by side: the browser's own architecture leads when it says, and
 * Apple silicon with a hint on finding the chip when it doesn't. A computer
 * Macro has no installer for (Windows, ChromeOS) gets them all as equals.
 */
function DesktopDownload() {
  const analytics = useAnalytics();
  const detected = detectDesktopPlatform(navigator.userAgent);
  const intel = intelMacPublished();
  const choosesMac = detected === 'macos' && intel;
  // Undefined until the browser answers; `unknown` once it can't say.
  const [architecture, setArchitecture] = createSignal<
    MacArchitecture | 'unknown'
  >();
  onMount(() => {
    if (!choosesMac) return;
    fireAndForget(
      loadMacArchitecture((value) => setArchitecture(value ?? 'unknown')),
      'settings.downloads.mac-architecture'
    );
  });

  const platforms = () => {
    const known = architecture();
    return desktopInstallers({
      system: detected,
      architecture: known === 'unknown' ? undefined : known,
      intel,
    });
  };
  const primary = () => (detected ? platforms()[0] : undefined);

  return (
    <SettingsSection
      title={t('settingsDownloads.desktopTitle')}
      target="Desktop app"
    >
      <SettingsCard>
        <SettingsRow
          label={t('settingsDownloads.desktopDownload')}
          description={
            <>
              {requirement(
                primary(),
                !choosesMac ||
                  (architecture() !== undefined && architecture() !== 'unknown')
              )}
              <Show when={architecture() === 'unknown'}>
                <span class="block">{t('settingsDownloads.macChipHint')}</span>
              </Show>
            </>
          }
          stackOnNarrow
        >
          <div class="flex flex-wrap gap-2">
            <For each={platforms()}>
              {(platform) => (
                <a
                  href={DESKTOP_DOWNLOAD_URLS[platform]}
                  class={buttonClasses({
                    variant: platform === primary() ? 'primary' : 'secondary',
                    size: 'md',
                  })}
                  onClick={() =>
                    analytics.track('desktop_download_clicked', {
                      platform,
                      source: 'app_settings',
                    })
                  }
                >
                  {downloadLabel(platform, intel, detected === 'macos')}
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
