import {
  type Component,
  type ComponentProps,
  createResource,
  Show,
} from 'solid-js';

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
export function lazy<T extends Component<any>>(
  load: () => Promise<{ default: T }>
) {
  let loading: Promise<{ default: T }> | undefined;
  let loaded: T | undefined;

  // A failed load is forgotten, so the next mount or preload tries again.
  const preload = () => {
    loading ??= load().then(
      (module) => {
        loaded = module.default;
        return module;
      },
      (error: unknown) => {
        loading = undefined;
        throw error;
      }
    );
    return loading;
  };

  const LazyComponent = (props: ComponentProps<T>) => {
    if (loaded) return loaded(props);

    const [module] = createResource(preload);
    return (
      <Show when={module()}>
        {(loadedModule) => loadedModule().default(props)}
      </Show>
    );
  };

  return Object.assign(LazyComponent, { preload });
}
