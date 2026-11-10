import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, onMount } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppView } from './app-route-shell';

const device = vi.hoisted(() => ({
  touch: true,
  width: (): number | undefined => 1000,
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ pageView: () => {}, track: () => {} }),
}));
vi.mock('@core/component/LoadingBlock', () => ({ LoadingBlock: () => null }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));
vi.mock('@components/app/split-layout/context', async () => {
  const { createContext } = await import('solid-js');
  return {
    SplitPanelContext: createContext({
      panelSize: {
        get width() {
          return device.width();
        },
      },
    }),
  };
});

beforeEach(() => {
  device.touch = true;
  device.width = () => 1000;
});
afterEach(cleanup);

it('keeps a requested detail inline on wide touch and switches at the sidebar breakpoint', () => {
  const [width, setWidth] = createSignal(1000);
  device.width = width;
  render(() => (
    <AppView
      id="channels"
      detailInlineOnly
      detailRequested={() => true}
      detailFallback={<p>Standalone detail</p>}
    >
      <p>Inline detail</p>
    </AppView>
  ));
  expect(screen.getByText('Inline detail')).toBeTruthy();
  expect(screen.queryByText('Standalone detail')).toBeNull();
  setWidth(720);
  expect(screen.getByText('Standalone detail')).toBeTruthy();
  setWidth(721);
  expect(screen.getByText('Inline detail')).toBeTruthy();
});

it('retains desktop inline details in narrow panes', () => {
  device.touch = false;
  device.width = () => 400;
  render(() => (
    <AppView
      id="email"
      detailInlineOnly
      detailRequested={() => true}
      detailFallback={<p>Standalone detail</p>}
    >
      <p>Inline detail</p>
    </AppView>
  ));
  expect(screen.getByText('Inline detail')).toBeTruthy();
});

it.each([undefined, 0])(
  'waits for a pane measurement before redirecting touch details from %s',
  (initialWidth) => {
    const [width, setWidth] = createSignal<number | undefined>(initialWidth);
    device.width = width;
    const redirect = vi.fn();
    function StandaloneDetail() {
      onMount(redirect);
      return <p>Standalone detail</p>;
    }
    render(() => (
      <AppView
        id="email"
        detailInlineOnly
        detailRequested={() => true}
        detailFallback={<StandaloneDetail />}
      >
        <p>Inline detail</p>
      </AppView>
    ));
    expect(screen.queryByText('Standalone detail')).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
    setWidth(1000);
    expect(screen.getByText('Inline detail')).toBeTruthy();
    setWidth(600);
    expect(screen.getByText('Standalone detail')).toBeTruthy();
    expect(redirect).toHaveBeenCalledOnce();
  }
);

it('keeps wide touch Notifications inline and redirects once when folded', () => {
  const [width, setWidth] = createSignal(1000);
  device.width = width;
  const redirect = vi.fn();
  function StandaloneDetail() {
    onMount(redirect);
    return <p>Standalone Home detail</p>;
  }
  render(() => (
    <AppView
      id="home"
      detailInlineOnly
      detailRequested={() => true}
      detailFallback={<StandaloneDetail />}
    >
      <p>Notifications preview</p>
    </AppView>
  ));
  expect(screen.getByText('Notifications preview')).toBeTruthy();
  expect(redirect).not.toHaveBeenCalled();
  setWidth(720);
  expect(screen.getByText('Standalone Home detail')).toBeTruthy();
  expect(redirect).toHaveBeenCalledOnce();
});

it('retains desktop Home previews', () => {
  device.touch = false;
  render(() => (
    <AppView
      id="home"
      detailInlineOnly
      detailRequested={() => true}
      detailFallback={<p>Standalone Home detail</p>}
    >
      <p>Home preview</p>
    </AppView>
  ));
  expect(screen.getByText('Home preview')).toBeTruthy();
  expect(screen.queryByText('Standalone Home detail')).toBeNull();
});
