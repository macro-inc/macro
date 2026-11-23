import MacroLogo from '@icon/macro-logo.svg';
import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { FeaturePage } from '../../features/marketing/components/FeaturePage';
import {
  ANDROID_PLAY_STORE_URL,
  DESKTOP_PLATFORM_DETAILS,
  DESKTOP_RELEASE_URL,
  type DesktopDownloadUrls,
  desktopPlatformOrder,
  desktopReleaseVersion,
  detectPhonePlatform,
  detectVisitorPlatform,
  FALLBACK_DOWNLOAD_URLS,
  fetchDesktopDownloadUrls,
  IOS_APP_STORE_URL,
  PHONE_PLATFORM_DETAILS,
  type PhonePlatform,
  phonePlatformOrder,
  type VisitorPlatform,
} from '../../features/marketing/core/desktopDownloads';
import { analytics } from '../utils/utilAnalytic';
import { setPageSeo } from '../utils/utilSeo';
import '../../features/documentation/components/documentation.css';
import './RouteDownload.css';

export function RouteDownload() {
  setPageSeo({
    title: 'Download Macro Alpha',
    description: 'Download the Macro alpha desktop app for macOS and Linux.',
    path: '/download',
  });

  const [downloads, setDownloads] = createSignal<DesktopDownloadUrls>(
    FALLBACK_DOWNLOAD_URLS
  );
  const [visitor, setVisitor] = createSignal<VisitorPlatform>();
  const [phone, setPhone] = createSignal<PhonePlatform>();
  const platforms = () => desktopPlatformOrder(visitor());
  const releaseVersion = () =>
    desktopReleaseVersion(downloads()[platforms()[0]]);

  onMount(() => {
    setVisitor(detectVisitorPlatform(navigator.userAgent));
    setPhone(detectPhonePlatform(navigator.userAgent));
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    const loadLatestRelease = async () => {
      setDownloads(await fetchDesktopDownloadUrls(controller.signal));
    };
    void loadLatestRelease();
  });

  return (
    <FeaturePage>
      <div class="downloads-page">
        <header class="downloads-header">
          <div class="downloads-app-icon" aria-hidden="true">
            <MacroLogo />
          </div>
          {/* Phones get the mobile apps, never the desktop installers. */}
          <h1>
            Download Macro
            <span class="downloads-desktop-only"> Alpha</span>
          </h1>
          <p class="downloads-desktop-only">Available for macOS and Linux</p>
          <p class="downloads-phone-only">Get Macro on your phone.</p>
        </header>

        <ul
          class="downloads-installers downloads-phone-only"
          aria-label="Mobile apps"
        >
          <For each={phonePlatformOrder(phone())}>
            {(platform, index) => (
              <li>
                <a
                  class={index() === 0 ? 'site-nav-start' : 'site-nav-demo'}
                  href={PHONE_PLATFORM_DETAILS[platform].url}
                >
                  Download for {PHONE_PLATFORM_DETAILS[platform].label}
                </a>
                <span>{PHONE_PLATFORM_DETAILS[platform].store}</span>
              </li>
            )}
          </For>
        </ul>

        <div class="downloads-action downloads-desktop-only">
          <ul class="downloads-installers" aria-label="Desktop installers">
            <For each={platforms()}>
              {(platform, index) => (
                <li>
                  <a
                    class={index() === 0 ? 'site-nav-start' : 'site-nav-demo'}
                    href={downloads()[platform]}
                    onClick={() =>
                      analytics.trackPosthog('desktop_download_clicked', {
                        platform,
                        source: 'marketing',
                      })
                    }
                  >
                    Download for {DESKTOP_PLATFORM_DETAILS[platform].label}
                  </a>
                  <span>{DESKTOP_PLATFORM_DETAILS[platform].requirement}</span>
                </li>
              )}
            </For>
          </ul>
        </div>

        <Show when={visitor() === 'windows'}>
          <p class="downloads-note downloads-desktop-only">
            Windows is not supported yet. <a href="/app">Use Macro</a> in your
            browser.
          </p>
        </Show>

        <p class="downloads-release downloads-desktop-only">
          <a href={DESKTOP_RELEASE_URL} target="_blank" rel="noreferrer">
            All releases
            <ArrowUpRight aria-hidden="true" />
          </a>
        </p>
        <Show when={releaseVersion()}>
          {(version) => (
            <p class="downloads-version downloads-desktop-only">{version()}</p>
          )}
        </Show>

        <article class="documentation-body">
          <h2 id="desktop" class="downloads-desktop-only">
            Desktop
          </h2>
          <p class="downloads-desktop-only">
            The macOS app requires macOS 13 (Ventura) or later on a Mac with
            Apple silicon. The Linux app is an x86_64 AppImage. The desktop app
            updates itself when a new release is published.
          </p>
          <p class="downloads-desktop-only">
            For self-hosting, see the{' '}
            <a href="/docs/security#self-hosting">self-hosting overview</a>.
          </p>
          <h2 id="web">Web</h2>
          <p>
            <a href="/app">Open Macro</a> in a modern browser. No installation
            needed.
          </p>
          <h2 id="ios">iOS</h2>
          <p>
            <a href={IOS_APP_STORE_URL}>Download Macro from the App Store</a>.
          </p>
          <h2 id="android">Android</h2>
          <p>
            <a href={ANDROID_PLAY_STORE_URL}>Download Macro from Google Play</a>
            .
          </p>
          <p>
            On a computer, you can also open{' '}
            <strong>Settings → Downloads</strong> in Macro and scan the QR code
            with your phone.
          </p>
          <p>
            The iOS and Android apps don't include splits, keyboard shortcuts,
            or some account and connection settings. Use the web or desktop app
            for those.
          </p>
        </article>
      </div>
    </FeaturePage>
  );
}
