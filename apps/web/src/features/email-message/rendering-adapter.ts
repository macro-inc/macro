import { useEmailRenderCache } from '@app/lib/email-render-cache/session';
import { useUserContext } from '@core/context/user';
import { interceptMailtoLinks } from '@core/util/interceptMailtoLinks';
import { createMemo, untrack } from 'solid-js';
import { themeReactive } from '../theme/signals/themeReactive';
import { themeUpdate } from '../theme/signals/themeSignals';
import type { EmailRenderingContextValue } from './context/email-rendering-context';
import { fetchImagesViaPlatform, resolveCidImages } from './image-adapter';
import { emailImagePolicy } from './rendering-policy';

export function createEmailRenderingContext(): EmailRenderingContextValue {
  const cache = useEmailRenderCache();
  const user = useUserContext();
  const owner = untrack(user.userId);
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
    canRender: () => user.isAuthenticated() === true && user.userId() === owner,
    get preparation() {
      return cache();
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
