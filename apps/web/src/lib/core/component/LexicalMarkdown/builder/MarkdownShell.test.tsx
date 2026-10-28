import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { buildConfig } from './MarkdownConfigBuilder';
import { MarkdownShell } from './MarkdownShell';

const connection = vi.hoisted(() => ({
  callback: undefined as (() => void) | undefined,
}));

vi.mock('@solid-primitives/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@solid-primitives/lifecycle')>()),
  onElementConnect: (_element: Element, callback: () => void) => {
    connection.callback = callback;
  },
}));

it('disposes reactive autofocus reads made during deferred editor connection', () => {
  const [touch, setTouch] = createSignal(false);
  const [autofocus] = createSignal(false);
  let reads = 0;
  const isTouch = () => {
    reads += 1;
    return touch();
  };
  const { unmount } = render(() => (
    <MarkdownShell
      config={buildConfig('plain-text')}
      autofocus={!isTouch() && autofocus()}
    />
  ));
  expect(connection.callback).toBeTypeOf('function');
  connection.callback!();
  expect(reads).toBeGreaterThan(0);
  unmount();
  const readsAtUnmount = reads;
  setTouch(true);
  expect(reads).toBe(readsAtUnmount);
});
