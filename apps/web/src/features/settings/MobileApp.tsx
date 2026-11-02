import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { storeListingUrl } from '@core/mobile/native-update-link';
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
    prompt: 'Download Macro on the',
    qr: AppStoreQr,
  },
  android: {
    device: 'Android',
    name: 'Google Play',
    prompt: 'Get Macro on',
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

  return (
    <SettingsPage
      title="Mobile app"
      description={
        isMobile()
          ? 'Download Macro from your app store.'
          : 'Scan the code to get Macro on your phone.'
      }
    >
      <SettingsCard>
        <Show when={isMobile()} fallback={<StoreQrCode />}>
          <StoreLinks />
        </Show>
      </SettingsCard>
    </SettingsPage>
  );
}

/** A phone can't scan its own screen, so phones get the store links instead. */
function StoreLinks() {
  return (
    <div class="flex flex-col gap-2 p-4">
      <For each={PLATFORMS}>
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
        aria-label="Phone"
        options={PLATFORM_TABS}
        value={platform()}
        onChange={setPlatform}
      />
      <Dynamic component={store().qr} class="block w-60" />
      <p class="text-sm text-ink text-center">
        {store().prompt}
        <br />
        {store().name}
      </p>
      <CopyButton
        aria-label={`Copy ${store().name} link`}
        variant="ghost"
        size="sm"
        tooltip={`Copy ${store().name} link`}
        onClick={() => copy(storeListingUrl(platform()))}
      >
        <LinkIcon class="size-3.5" />
        Copy link
      </CopyButton>
    </div>
  );
}
