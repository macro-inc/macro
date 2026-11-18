import { createResource, type JSX, Show } from 'solid-js';

/**
 * Solid's `lazy()`, with each rendered instance waiting on the module itself.
 *
 * Solid's `lazy()` shares one load resource between instances, owned by the
 * first to render. If that one unmounts mid-load, the others leave their
 * Suspense and render nothing for good (repro: two `<Suspense><Lazy /></Suspense>`,
 * unmount the first before its import resolves). Here only the module promise
 * and the loaded component are shared.
 */
export function lazy<Props extends unknown[]>(
  load: () => Promise<{ default: (...props: Props) => JSX.Element }>
) {
  let loading:
    | Promise<{ default: (...props: Props) => JSX.Element }>
    | undefined;
  let loaded: ((...props: Props) => JSX.Element) | undefined;

  const loadComponent = async () => {
    try {
      const module = await load();
      loaded = module.default;
      return module;
    } catch (error) {
      // Forget the failed load, so the next mount or preload tries again.
      loading = undefined;
      throw error;
    }
  };

  const preload = () => {
    loading ??= loadComponent();
    return loading;
  };

  const LazyComponent = (...props: Props) => {
    if (loaded) return loaded(...props);

    const [module] = createResource(preload);
    return (
      <Show when={module()}>
        {(loadedModule) => loadedModule().default(...props)}
      </Show>
    );
  };

  return Object.assign(LazyComponent, { preload });
}
