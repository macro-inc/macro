import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const loading = vi.hoisted(() => ({
  platform: 'web',
  started: Promise.withResolvers<void>(),
  release: Promise.withResolvers<void>(),
  requests: 0,
  mounted: [] as string[][],
}));
const [files, setFiles] = createSignal<{ token: string }[]>([]);
vi.mock('@macro/tauri', () => ({
  useTauri: () => ({ os: loading.platform }),
  useShareTarget: () => ({
    pendingShareFiles: files,
    clearPendingShareFiles: async () => {
      setFiles([]);
    },
  }),
}));
vi.mock('@components/app/mobile/ConfirmDrawer', () => ({
  ConfirmDrawer: () => null,
}));
vi.mock('@components/app/mobile/MobileDrawer', () => {
  const Root = (props: { open: boolean; children: JSX.Element }) => (
    <Show when={props.open}>{props.children}</Show>
  );
  return {
    MobileDrawer: Object.assign(Root, {
      Portal: (props: { children: JSX.Element }) => props.children,
      Overlay: () => null,
      Handle: () => null,
      Content: (props: { children: JSX.Element }) => (
        <div role="dialog">{props.children}</div>
      ),
    }),
  };
});
vi.mock('@ui', () => ({
  Button: (props: {
    children: JSX.Element;
    disabled: boolean;
    onClick: () => void;
  }) => (
    <button disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));
vi.mock('./NativeShareSheetComposer', async () => {
  loading.requests++;
  loading.started.resolve();
  await loading.release.promise;
  return {
    NativeShareSheetComposer: () => {
      loading.mounted.push(files().map((file) => file.token));
      return <div>Native composer</div>;
    },
  };
});

import { NativeShareSheet } from './NativeShareSheet';

afterEach(() => {
  cleanup();
  setFiles([]);
});

it('keeps an inactive native share composer out of web and idle native startup', () => {
  render(() => <NativeShareSheet />);
  expect(loading.requests).toBe(0);
  cleanup();
  loading.platform = 'ios';
  render(() => <NativeShareSheet />);
  expect(loading.requests).toBe(0);
});

it('can discard a batch during loading without mounting it after the import resolves', async () => {
  loading.platform = 'ios';
  setFiles([{ token: 'discarded' }]);
  render(() => <NativeShareSheet />);
  await loading.started.promise;
  expect(
    screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(files()).toEqual([]);
  expect(screen.queryByRole('dialog')).toBeNull();
  loading.release.resolve();
  await import('./NativeShareSheetComposer');
  expect(loading.mounted).toEqual([]);
  setFiles([{ token: 'next-batch' }]);
  await screen.findByText('Native composer');
  expect(loading.requests).toBe(1);
  expect(loading.mounted).toEqual([['next-batch']]);
});
