import { ENABLE_PROXY_EMAIL_IMAGES } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { interceptMailtoLinks } from '@core/util/interceptMailtoLinks';
import { createMemo } from 'solid-js';
import { themeReactive } from '../theme/signals/themeReactive';
import { themeUpdate } from '../theme/signals/themeSignals';
import type { EmailRenderingContextValue } from './context/email-rendering-context';
import { fetchImagesViaPlatform, resolveCidImages } from './image-adapter';

export function createEmailRenderingContext(): EmailRenderingContextValue {
  const theme = createMemo(() => {
    themeUpdate();
    return {
      inkL: themeReactive.c0.l[0](),
      inkC: themeReactive.c0.c[0](),
      inkH: themeReactive.c0.h[0](),
      panelL: themeReactive.b1.l[0](),
      accentL: themeReactive.a0.l[0](),
      accentC: themeReactive.a0.c[0](),
      accentH: themeReactive.a0.h[0](),
    };
  });
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
