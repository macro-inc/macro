/**
 * @vitest-environment jsdom
 */

import { render } from '@solidjs/testing-library';
import { createSignal, Show, Suspense } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { lazyOnce } from '../lazy-once';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function Loaded() {
  return <div data-testid="loaded">loaded</div>;
}

/** Mounts and unmounts the component on demand, under one `<Suspense>`. */
function mountHarness(component: () => unknown) {
  const [shown, setShown] = createSignal(true);
  const result = render(() => (
    <Suspense fallback={<div data-testid="fallback">loading</div>}>
      <Show when={shown()}>{component() as never}</Show>
    </Suspense>
  ));
  return { ...result, setShown };
}

describe('lazyOnce', () => {
  it('waits for the module on the first mount', async () => {
    const gate = defer<{ default: typeof Loaded }>();
    const View = lazyOnce(() => gate.promise);
    const { queryByTestId } = mountHarness(() => <View />);

    expect(queryByTestId('fallback')).not.toBeNull();
    expect(queryByTestId('loaded')).toBeNull();

    gate.resolve({ default: Loaded });
    await flush();

    expect(queryByTestId('fallback')).toBeNull();
    expect(queryByTestId('loaded')).not.toBeNull();
  });

  it('does not suspend again when the same component is remounted', async () => {
    const View = lazyOnce(async () => ({ default: Loaded }));
    const { queryByTestId, setShown } = mountHarness(() => <View />);
    await flush();
    expect(queryByTestId('loaded')).not.toBeNull();

    setShown(false);
    setShown(true);

    // Synchronous: the remounted view is on screen in the same update that
    // removed the old one, with no fallback in between.
    expect(queryByTestId('fallback')).toBeNull();
    expect(queryByTestId('loaded')).not.toBeNull();
  });

  it('imports the module only once across mounts and preloads', async () => {
    let imports = 0;
    const View = lazyOnce(async () => {
      imports += 1;
      return { default: Loaded };
    });

    View.preload();
    View.preload();
    await flush();

    const { setShown } = mountHarness(() => <View />);
    setShown(false);
    setShown(true);
    await flush();

    expect(imports).toBe(1);
  });

  it('mounts without suspending once preloaded', async () => {
    const View = lazyOnce(async () => ({ default: Loaded }));
    View.preload();
    await flush();

    const { queryByTestId } = mountHarness(() => <View />);

    expect(queryByTestId('fallback')).toBeNull();
    expect(queryByTestId('loaded')).not.toBeNull();
  });
});
