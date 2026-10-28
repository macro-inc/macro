import { ENABLE_PROXY_EMAIL_IMAGES } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { interceptMailtoLinks } from '@core/util/interceptMailtoLinks';
import type { EmailRenderingContextValue } from './context/email-rendering-context';
import { fetchImagesViaPlatform, resolveCidImages } from './image-adapter';
import { createEmailTheme } from './theme';

export function createEmailRenderingContext(): EmailRenderingContextValue {
  const theme = createEmailTheme();
  return {
    theme,
    images: {
      remote: 'allow',
      proxyUrl: ENABLE_PROXY_EMAIL_IMAGES
        ? `${SERVER_HOSTS['image-proxy-service']}/proxy`
        : undefined,
    },
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
