import { prepareLoro } from '@core/loro-runtime';

/** Code/runtime preparation only: editor and document instances belong to mount. */
export async function loadMarkdownComponent() {
  const [, component] = await Promise.all([
    prepareLoro(),
    import('./component/Block'),
  ]);
  return component;
}
