import type { Rollup } from 'vite';

/** The tutorial videos and their posters, which `catalog.ts` lists. */
const TUTORIAL_MEDIA =
  /^src\/features\/video-tutorials\/assets\/[^/]+(\.mp4|-poster\.jpg)$/;

/**
 * Build output names for assets. The tutorial videos and posters (about
 * 140 MB) go under `assets/tutorials/`, so the iOS and Android apps can ship
 * without them: `strip-native-tutorials.sh` removes that folder from the
 * native builds (`just build-tauri`) and from the over-the-air archive
 * (`infra/stacks/web-app`). The web app serves them from there as before.
 * The feature's other images (the presenter and support faces) stay with the
 * rest of the assets: the dialog loads them from the bundle.
 */
export function assetFileNames(pattern: string) {
  return (asset: Rollup.PreRenderedAsset) =>
    asset.originalFileNames.some((file) => TUTORIAL_MEDIA.test(file))
      ? `assets/tutorials/${pattern}`
      : `assets/${pattern}`;
}
