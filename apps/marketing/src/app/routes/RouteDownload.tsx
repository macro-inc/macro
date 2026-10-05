import MacroLogo from '@icon/macro-logo.svg';
import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { FeaturePage } from '../../features/marketing/components/FeaturePage';
import {
  DESKTOP_RELEASE_API_URL,
  DESKTOP_RELEASE_URL,
  type DesktopDownloadUrls,
  FALLBACK_DOWNLOAD_URLS,
  releaseDownloadUrls,
} from '../../features/marketing/core/desktopDownloads';
import { SectionMoreFeatures } from '../components/sections/SectionMoreFeatures';
import { setPageSeo } from '../utils/utilSeo';
import './RouteDownload.css';

export function RouteDownload() {
  setPageSeo({
    title: 'Download Macro for macOS',
    description:
      'Download the latest release of Macro for macOS. Available for Apple silicon Macs.',
    path: '/download',
  });

  const [downloads, setDownloads] = createSignal<DesktopDownloadUrls>(
    FALLBACK_DOWNLOAD_URLS
  );
  const [releaseTag, setReleaseTag] = createSignal<string>();

  onMount(() => {
    const controller = new AbortController();
    const loadLatestRelease = async () => {
      try {
        const response = await fetch(DESKTOP_RELEASE_API_URL, {
          headers: { Accept: 'application/vnd.github+json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Unable to load desktop release');
        const release = await response.json();
        setDownloads(releaseDownloadUrls(release));
        if (typeof release.tag_name === 'string')
          setReleaseTag(release.tag_name);
      } catch {
        // The release page remains a usable fallback if the API is unavailable.
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
          <p>Available for macOS.</p>
        </header>

        <div class="downloads-action">
          <a class="site-nav-start" href={downloads().macos}>
            Download for macOS
          </a>
          <p>Apple silicon · DMG</p>
        </div>

        <p class="downloads-release">
          <a href={DESKTOP_RELEASE_URL} target="_blank" rel="noreferrer">
            {releaseTag() ? `Release ${releaseTag()}` : 'Latest release'}
            <ArrowUpRight aria-hidden="true" />
          </a>
        </p>
      </div>
      <SectionMoreFeatures currentPath="/download" footerOnly />
    </FeaturePage>
  );
}
