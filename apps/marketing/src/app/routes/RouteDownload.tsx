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
  const platforms = () => desktopPlatformOrder(visitor());
  const releaseVersion = () =>
    desktopReleaseVersion(downloads()[platforms()[0]]);

  onMount(() => {
    setVisitor(detectVisitorPlatform(navigator.userAgent));
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
          <h1>Download Macro Alpha</h1>
          <p>Available for macOS and Linux</p>
        </header>

        <p class="downloads-phone-note">
          Open this page on a Mac or Linux computer to download the desktop app.
        </p>

        <div class="downloads-action">
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
            You can also open <strong>Settings → Downloads</strong> in Macro and
            scan the QR code.
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
