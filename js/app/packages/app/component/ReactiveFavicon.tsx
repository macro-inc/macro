import { updateFavicon } from '@app/util/favicon';
import { createEffect } from 'solid-js';
import { themeReactive } from '../../block-theme/signals/themeReactive';

export function ReactiveFavicon() {
  createEffect(() => {
    const { l, c, h } = themeReactive.a0;
    const col = `oklch(${l[0]()} ${c[0]()} ${h[0]()}deg)`;
    updateFavicon(col);
  });
  return null;
}
