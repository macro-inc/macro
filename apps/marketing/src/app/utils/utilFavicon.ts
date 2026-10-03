import { createEffect } from 'solid-js';
import { themeReactive } from '../../lib/theme/signals/themeReactive';

export function utilFaviconEffect() {
  createEffect(() => {
    const elementFavicon = document.getElementById('favicon')!;

    elementFavicon.setAttribute(
      'href',
      `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 37 24' fill='oklch(${themeReactive.a0.l[0]()} ${themeReactive.a0.c[0]()} ${themeReactive.a0.h[0]()}deg)' stroke='none'%3E%3Cpath d='m9.8244-1.376e-4 -3.3805 1.3255v8.7737l-2.6475-2.5002-3.3805 1.3255v10.068c-2e-6 0.387 0.15933 0.757 0.44056 1.023l4.2128 3.9842 3.384-1.3255v-8.7738l10.681 10.099 3.384-1.3256v-8.7737l10.685 10.099 3.3805-1.3255v-10.068c0-0.3871-0.1593-0.757-0.4405-1.023l-12.25-11.583-3.384 1.3255v8.7737z'/%3E%3C/svg%3E`
    );
  });
}
