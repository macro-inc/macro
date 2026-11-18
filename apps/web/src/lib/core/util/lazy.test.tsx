import { render } from '@solidjs/testing-library';
import { createSignal, Show, Suspense } from 'solid-js';
import { expect, it } from 'vitest';
import { lazy } from './lazy';

it('renders in every instance after the instance that started the load unmounts mid-load', async () => {
  let resolveModule!: (module: { default: () => string }) => void;
  const module = new Promise<{ default: () => string }>((resolve) => {
    resolveModule = resolve;
  });
  const Poll = lazy(() => module);
  const [firstShown, setFirstShown] = createSignal(true);
  const { container } = render(() => (
    <>
      <Show when={firstShown()}>
        <div data-card="first">
          <Suspense fallback="Loading first">
            <Poll />
          </Suspense>
        </div>
      </Show>
      <div data-card="second">
        <Suspense fallback="Loading second">
          <Poll />
        </Suspense>
      </div>
    </>
  ));
  expect(container.querySelector('[data-card="second"]')?.textContent).toBe(
    'Loading second'
  );

  setFirstShown(false);
  resolveModule({ default: () => 'Pick your size' });
  await Poll.preload();

  expect(container.querySelector('[data-card="second"]')?.textContent).toBe(
    'Pick your size'
  );
});

it('remounts a loaded component at once, without its fallback', async () => {
  const module = Promise.resolve({ default: () => 'Pick your size' });
  const Poll = lazy(() => module);
  const [shown, setShown] = createSignal(true);
  const { container } = render(() => (
    <Show when={shown()}>
      <Suspense fallback="Loading">
        <Poll />
      </Suspense>
    </Show>
  ));
  await Poll.preload();
  expect(container.textContent).toBe('Pick your size');

  setShown(false);
  setShown(true);

  expect(container.textContent).toBe('Pick your size');
});

it('renders at once after preload resolves', async () => {
  const Poll = lazy(() => Promise.resolve({ default: () => 'Pick your size' }));
  await Poll.preload();

  const { container } = render(() => (
    <Suspense fallback="Loading">
      <Poll />
    </Suspense>
  ));

  expect(container.textContent).toBe('Pick your size');
});
