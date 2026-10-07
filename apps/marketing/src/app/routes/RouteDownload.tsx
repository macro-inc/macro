import MacroLogo from '@icon/macro-logo.svg';
import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { FeaturePage } from '../../features/marketing/components/FeaturePage';
import {
  DESKTOP_RELEASE_API_URL,
  DESKTOP_RELEASE_URL,
  type DesktopDownloadUrls,
  type DesktopPlatform,
  desktopReleaseVersion,
  detectDesktopPlatform,
  FALLBACK_DOWNLOAD_URLS,
  releaseDownloadUrls,
} from '../../features/marketing/core/desktopDownloads';
import { SectionMoreFeatures } from '../components/sections/SectionMoreFeatures';
import { setPageSeo } from '../utils/utilSeo';
import './RouteDownload.css';

export function RouteDownload() {
  setPageSeo({
    title: 'Download Macro for macOS and Linux',
    description: 'Download the latest release of Macro for macOS and Linux.',
    path: '/download',
  });

  const [downloads, setDownloads] = createSignal<DesktopDownloadUrls>(
    FALLBACK_DOWNLOAD_URLS
  );
  const [platform, setPlatform] = createSignal<DesktopPlatform>('macos');
  const downloadUrl = () => downloads()[platform()];
  const releaseVersion = () => desktopReleaseVersion(downloadUrl());

  onMount(() => {
    setPlatform(detectDesktopPlatform(navigator.userAgent));
    const controller = new AbortController();
    const loadLatestRelease = async () => {
      try {
        const response = await fetch(DESKTOP_RELEASE_API_URL, {
          headers: { Accept: 'application/vnd.github+json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Unable to load desktop release');
        const releases = await response.json();
        setDownloads(releaseDownloadUrls(releases));
      } catch {
        // Keep direct installer links usable if GitHub is unavailable or rate-limited.
      }
    };
    void loadLatestRelease();
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
          <p>Available for macOS and Linux</p>
        </header>

        <div class="downloads-action">
          <a class="site-nav-start" href={downloadUrl()}>
            Download for {platform() === 'linux' ? 'Linux' : 'macOS'}
          </a>
        </div>

        <p class="downloads-release">
          <a href={DESKTOP_RELEASE_URL} target="_blank" rel="noreferrer">
            All releases
            <ArrowUpRight aria-hidden="true" />
          </a>
        </p>
        <Show when={releaseVersion()}>
          {(version) => <p class="downloads-version">{version()}</p>}
        </Show>
      </div>
      <SectionMoreFeatures currentPath="/download" footerOnly />
    </FeaturePage>
  );
}
