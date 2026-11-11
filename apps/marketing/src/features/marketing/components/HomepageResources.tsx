import { createSignal, onMount, Show } from 'solid-js';
import {
  ensureGithubStars,
  formatStarCount,
  githubStars,
} from '../../../app/utils/utilGithubStars';
import {
  DESKTOP_RELEASE_API_URL,
  FALLBACK_DOWNLOAD_URLS,
  releaseDownloadUrls,
} from '../core/desktopDownloads';
import './homepage-resources.css';

/** Homepage companion to the feature pages' section outline. */
export function HomepageResources() {
  const [macDownload, setMacDownload] = createSignal(
    FALLBACK_DOWNLOAD_URLS.macos
  );
  onMount(ensureGithubStars);
  onMount(() => {
    fetch(DESKTOP_RELEASE_API_URL)
      .then((response) => {
        if (!response.ok) throw new Error('Release lookup failed');
        return response.json();
      })
      .then((releases) => setMacDownload(releaseDownloadUrls(releases).macos))
      .catch(() => {
        // Keep the direct installer usable when GitHub is unavailable.
      });
  });
  return (
    <aside class="page-outline homepage-resources" aria-label="Resources">
      <p>Resources</p>
      <nav aria-label="Macro resources">
        <a
          href="https://apps.apple.com/us/app/macro-app/id6743133649"
          target="_blank"
          rel="noreferrer"
        >
          Download for iOS
        </a>
        <a href={macDownload()}>Download for Mac</a>
        <a
          href="https://play.google.com/store/apps/details?id=com.macro.workspace.mobile"
          target="_blank"
          rel="noreferrer"
        >
          Download for Android
        </a>
        <a
          href="https://github.com/macro-inc/macro"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
          <span class="homepage-resource-stars">
            <Show when={githubStars() !== null}>
              <span aria-label={`${githubStars()} stars`}>
                <span aria-hidden="true">☆ </span>
                {formatStarCount(githubStars()!)}
              </span>
            </Show>
          </span>
        </a>
        <a href="https://x.com/macrodotcom" target="_blank" rel="noreferrer">
          X / Twitter
        </a>
        <a
          href="https://www.linkedin.com/company/macrocom"
          target="_blank"
          rel="noreferrer"
        >
          LinkedIn
        </a>
        <a
          href="https://www.instagram.com/macrodotcom/"
          target="_blank"
          rel="noreferrer"
        >
          Instagram
        </a>
      </nav>
    </aside>
  );
}
