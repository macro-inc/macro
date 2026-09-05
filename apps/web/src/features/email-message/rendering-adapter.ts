import { interceptMailtoLinks } from '@core/util/interceptMailtoLinks';
import { createMemo } from 'solid-js';
import { themeReactive } from '../theme/signals/themeReactive';
import { themeUpdate } from '../theme/signals/themeSignals';
import type { EmailRenderingDependencies } from './context/email-rendering-context';
import { fetchImagesViaPlatform, resolveCidImages } from './image-adapter';

export function createEmailRenderingDependencies(): EmailRenderingDependencies {
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
    prepareLinks: interceptMailtoLinks,
    async resolveImages(root, attachments, blobUrls, isDisposed) {
      if (isDisposed()) return;
      resolveCidImages(root, attachments);
      if (isDisposed()) return;
      await fetchImagesViaPlatform(root, blobUrls, isDisposed);
    },
  };
}
