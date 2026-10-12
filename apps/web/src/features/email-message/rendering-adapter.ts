import { useEmailRenderCacheRollout } from '@app/lib/email-render-cache/session';
import { useUserContext } from '@core/context/user';
import { interceptMailtoLinks } from '@core/util/interceptMailtoLinks';
import { createMemo, untrack } from 'solid-js';
import { reportEmailBodyShown } from './body-telemetry';
import { useEmailBodyOpenObserver } from './context/body-open';
import type { EmailRenderingContextValue } from './context/email-rendering-context';
import { fetchImagesViaPlatform, resolveCidImages } from './image-adapter';
import { emailImagePolicy } from './rendering-policy';
import { createEmailTheme } from './theme';

export function createEmailRenderingContext(): EmailRenderingContextValue {
  const rollout = useEmailRenderCacheRollout();
  const opens = useEmailBodyOpenObserver();
  const user = useUserContext();
  // The first viewer this surface renders for. A cold start may mount before
  // user info loads, so adopt the first known id instead of snapshotting.
  const owner = createMemo<string | undefined>(
    (first) => first ?? (user.userId() || undefined)
  );
  const theme = createEmailTheme();
  return {
    theme,
    cachedBodies: rollout.enabled,
    reportBodyShown: (shown) => {
      reportEmailBodyShown(shown, untrack(rollout.arm));
      opens?.shown(shown);
    },
    trackBodyOpen: opens && ((messageId) => opens.pending(messageId)),
    // Revoke only once the identity is cleared (a confirmed sign-out stores
    // an empty one) or replaced by another account. A raw 401 keeps the
    // retained identity, and an unknown one (cold start) keeps rendering.
    canRender: () => {
      const id = user.userId();
      if (id === undefined) return true;
      return id !== '' && id === (owner() ?? id);
    },
    get preparation() {
      return rollout.cache();
    },
    images: emailImagePolicy,
    prepareLinks: interceptMailtoLinks,
    async resolveImages(root, attachments, lifetime) {
      const blobUrls: string[] = [];
      const isDisposed = () => lifetime.signal.aborted;
      lifetime.onDispose(() => {
        for (const url of blobUrls) URL.revokeObjectURL(url);
      });
      if (isDisposed()) return;
      resolveCidImages(root, attachments);
      if (isDisposed()) return;
      await fetchImagesViaPlatform(root, blobUrls, isDisposed);
    },
  };
}
