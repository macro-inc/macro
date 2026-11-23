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
  detectVisitorPlatform,
  FALLBACK_DOWNLOAD_URLS,
  fetchDesktopDownloadUrls,
  IOS_APP_STORE_URL,
  type VisitorPlatform,
} from '../../features/marketing/core/desktopDownloads';
import { setPageSeo } from '../utils/utilSeo';
import '../../features/documentation/components/documentation.css';
import './RouteDownload.css';

export function RouteDownload() {
  setPageSeo({
    title: 'Download Macro',
    description:
      'Download the Macro desktop app for macOS and Linux, or get Macro on iOS and Android.',
    path: '/download',
  });

  const [downloads, setDownloads] = createSignal<DesktopDownloadUrls>(
    FALLBACK_DOWNLOAD_URLS
  );
  const [visitor, setVisitor] = createSignal<VisitorPlatform>();
  const platforms = () => desktopPlatformOrder(visitor());
  const onPhone = () => visitor() === 'ios' || visitor() === 'android';
  const releaseVersion = () =>
    desktopReleaseVersion(downloads()[platforms()[0]]);

  onMount(() => {
    setVisitor(
      detectVisitorPlatform(navigator.userAgent, navigator.maxTouchPoints)
    );
    const controller = new AbortController();
    void fetchDesktopDownloadUrls(controller.signal).then(setDownloads);
    onCleanup(() => controller.abort());
  });

  return (
    <FeaturePage>
      <div class="downloads-page">
        <header class="downloads-header">
          <div class="downloads-app-icon" aria-hidden="true">
            <MacroLogo />
          </div>
          <h1>Download Macro</h1>
          <p>
            <Show
              when={onPhone()}
              fallback="The desktop app for macOS and Linux."
            >
              Get Macro on your phone, or open this page on a computer for the
              desktop app.
            </Show>
          </p>
        </header>

        <div class="downloads-action">
          <Show when={visitor() === 'ios'}>
            <a class="site-nav-start" href={IOS_APP_STORE_URL}>
              Download for iOS
            </a>
          </Show>
          <Show when={visitor() === 'android'}>
            <a class="site-nav-start" href={ANDROID_PLAY_STORE_URL}>
              Download for Android
            </a>
          </Show>
          <ul class="downloads-installers" aria-label="Desktop installers">
            <For each={platforms()}>
              {(platform, index) => (
                <li>
                  <a
                    class={
                      index() === 0 && !onPhone()
                        ? 'site-nav-start'
                        : 'site-nav-demo'
                    }
                    href={downloads()[platform]}
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
          <p class="downloads-note">
            Windows is not supported yet. <a href="/app">Use Macro</a> in your
            browser.
          </p>
        </Show>

        <p class="downloads-release">
          <a href={DESKTOP_RELEASE_URL} target="_blank" rel="noreferrer">
            All releases
            <ArrowUpRight aria-hidden="true" />
          </a>
        </p>
        <Show when={releaseVersion()}>
          {(version) => <p class="downloads-version">{version()}</p>}
        </Show>

        <article class="documentation-body">
          <h2 id="desktop">Desktop</h2>
          <p>
            The desktop app runs on macOS 15 or later with Apple silicon, and on
            x86_64 Linux as an AppImage. It updates itself when a new release is
            published.
          </p>
          <p>
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
            You can also open <strong>Settings → Mobile App</strong> in Macro
            and scan the QR code.
          </p>
          <h2 id="android">Android</h2>
          <p>
            <a href={ANDROID_PLAY_STORE_URL}>Download Macro from Google Play</a>
            .
          </p>
          <p>
            Splits, keyboard shortcuts, and some account and connection settings
            are available only on the web and desktop apps.
          </p>
        </article>
      </div>
    </FeaturePage>
  );
}
