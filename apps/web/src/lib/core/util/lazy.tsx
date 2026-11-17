import { createResource, type JSX, Show } from 'solid-js';

/**
 * Solid's `lazy()`, with each rendered instance waiting on the module itself.
 *
 * Solid's `lazy()` shares one load resource between instances, created and
 * owned by the first instance that renders. When that instance unmounts
 * mid-load, the resource's cleanup releases every other instance's Suspense
 * and drops the load, so the others render nothing for good, with no fallback
 * and no error (still the case in solid-js 1.9.19; repro: two
 * `<Suspense><Lazy /></Suspense>`, unmount the first before its import
 * resolves). Solid 1.9.14 also forgets the loaded component when any instance
 * unmounts, so a remount shows its fallback again (solidjs/solid#4118).
 *
 * Here only the module promise and the loaded component are shared: an
 * instance mounted after the load renders at once, and one mounted during it
 * owns its own wait.
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
