import { t } from '@app/lib/i18n';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { storeListingUrl } from '@core/mobile/native-update-link';
import { storePlatform } from '@core/mobile/storePlatform';
import { useCopyLink } from '@core/util/useCopyLink';
import AppStoreQr from '@design/app-store.svg';
import PlayStoreQr from '@design/play-store.svg';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import { buttonClasses, CopyButton, Tabs } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { NativeAppInfo } from './NativeAppInfo';
import { SettingsCard, SettingsPage } from './primitives';

const STORES = {
  ios: {
    device: 'iPhone',
    name: 'App Store',
    get prompt() {
      return t('settingsMobileApp.appStorePrompt');
    },
    get description() {
      return t('settingsMobileApp.appStoreDescription');
    },
    qr: AppStoreQr,
  },
  android: {
    device: 'Android',
    name: 'Google Play',
    get prompt() {
      return t('settingsMobileApp.googlePlayPrompt');
    },
    get description() {
      return t('settingsMobileApp.googlePlayDescription');
    },
    qr: PlayStoreQr,
  },
};

type Platform = keyof typeof STORES;

const PLATFORMS: Platform[] = ['ios', 'android'];

const PLATFORM_TABS = PLATFORMS.map((value) => ({
  value,
  label: STORES[value].device,
}));

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

  // A phone gets just its own store when its browser says which phone it is.
  const detected = storePlatform(navigator.userAgent, navigator.maxTouchPoints);

  return (
    <SettingsPage
      title={t('settingsMobileApp.title')}
      description={
        isMobile()
          ? storeLinksDescription(detected)
          : t('settingsMobileApp.scanDescription')
      }
    >
      <SettingsCard>
        <Show when={isMobile()} fallback={<StoreQrCode />}>
          <StoreLinks platforms={detected ? [detected] : PLATFORMS} />
        </Show>
      </SettingsCard>
    </SettingsPage>
  );
}

function storeLinksDescription(platform: Platform | undefined) {
  if (!platform) return t('settingsMobileApp.storeLinksDescription');
  return STORES[platform].description;
}

/** A phone can't scan its own screen, so phones get store links instead. */
function StoreLinks(props: { platforms: Platform[] }) {
  return (
    <div class="flex flex-col gap-2 p-4">
      <For each={props.platforms}>
        {(platform) => (
          <a
            href={storeListingUrl(platform)}
            target="_blank"
            rel="noopener noreferrer"
            class={buttonClasses({
              variant: 'secondary',
              size: 'lg',
              fullWidth: true,
            })}
          >
            {STORES[platform].name}
            <ArrowUpRightIcon class="size-4" />
          </a>
        )}
      </For>
    </div>
  );
}

function StoreQrCode() {
  const copy = useCopyLink();
  const [platform, setPlatform] = createSignal<Platform>('ios');
  const store = () => STORES[platform()];

  return (
    <div class="flex flex-col items-center gap-6 px-6 pt-10 pb-12">
      <Tabs
        aria-label={t('settingsMobileApp.phone')}
        options={PLATFORM_TABS}
        value={platform()}
        onChange={setPlatform}
      />
      <Dynamic component={store().qr} class="block w-60" />
      <p class="min-h-10 max-w-44 text-sm text-ink text-center">
        {store().prompt}
      </p>
      <CopyButton
        aria-label={t('settingsMobileApp.copyStoreLink', {
          store: store().name,
        })}
        variant="ghost"
        size="sm"
        tooltip={t('settingsMobileApp.copyStoreLink', { store: store().name })}
        onClick={() => copy(storeListingUrl(platform()))}
        icon={<LinkIcon class="size-3.5" />}
      >
        {t('settingsMobileApp.copyLink')}
      </CopyButton>
    </div>
  );
}
