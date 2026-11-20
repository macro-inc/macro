import { setGlobalSplitManager } from '@app/signal/splitLayout';
import type { SplitManager } from '@components/app/split-layout/layoutManager';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { batch, createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { closeSheetsForNavigation } from './close-on-navigation';
import { type DrawerSnapPoint, MobileDrawer } from './MobileDrawer';

/**
 * What the active pane shows. `view` names the mounted view: navigating to
 * other content mounts a new one, while a search change or an adopted id
 * keeps it.
 */
type Page = { split: string; view: string; id?: string; search?: string };

const [page, setPage] = createSignal<Page | undefined>();
const VIEWS = new Map<string, () => null>();
const mountedView = (name: string) => {
  const existing = VIEWS.get(name);
  if (existing) return existing;
  const view = () => null;
  VIEWS.set(name, view);
  return view;
};

beforeEach(() => {
  const computedStyle = window.getComputedStyle;
  vi.stubGlobal('getComputedStyle', (element: Element) => {
    const style = computedStyle(element);
    // As browsers report an element without a transition, so the sheet
    // leaves once it has closed instead of waiting for a JSDOM transition.
    style.transitionDuration ||= '0s';
    style.animationName ||= 'none';
    return style;
  });
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  setPage({ split: 'front', view: 'notes' });
  // Only the active split is read: which pane shows, and the view in it.
  setGlobalSplitManager({
    activeSplitId: () => page()?.split,
    splitState: (id: string) => {
      const shown = page();
      if (shown?.split !== id) return;
      return {
        id,
        content: { type: 'md', id: shown.id ?? shown.view },
        mount: { kind: 'block', element: mountedView(shown.view) },
      };
    },
  } as unknown as SplitManager);
});

afterEach(() => {
  cleanup();
  setGlobalSplitManager(undefined);
  vi.unstubAllGlobals();
});

function Sheet(props: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  keepOpenOnNavigation?: boolean;
}) {
  return (
    <MobileDrawer
      open={props.open}
      onOpenChange={props.onOpenChange}
      keepOpenOnNavigation={props.keepOpenOnNavigation}
    >
      <MobileDrawer.Trigger>Open sheet</MobileDrawer.Trigger>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label="Sheet">
          <MobileDrawer.Item>Row</MobileDrawer.Item>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

async function expectClosed() {
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

function renderControlled(
  options: { refuseClose?: boolean; keepOpenOnNavigation?: boolean } = {}
) {
  const [open, setOpen] = createSignal(false);
  const onOpenChange = vi.fn((next: boolean) => {
    if (!next && options.refuseClose) return;
    setOpen(next);
  });
  render(() => (
    <Sheet
      open={open()}
      onOpenChange={onOpenChange}
      keepOpenOnNavigation={options.keepOpenOnNavigation}
    />
  ));
  fireEvent.click(screen.getByText('Open sheet'));
  expect(screen.getByRole('dialog', { name: 'Sheet' })).toBeTruthy();
  return { onOpenChange };
}

it('closes when another pane comes to the front', async () => {
  const { onOpenChange } = renderControlled();

  setPage({ split: 'channel-pane', view: 'general' });

  expect(onOpenChange).toHaveBeenLastCalledWith(false);
  await expectClosed();
});

it('closes when the pane under it shows other content', async () => {
  renderControlled();

  setPage({ split: 'front', view: 'plans' });

  await expectClosed();
});

it('closes an uncontrolled sheet', async () => {
  render(() => <Sheet />);
  fireEvent.click(screen.getByText('Open sheet'));
  expect(screen.getByRole('dialog', { name: 'Sheet' })).toBeTruthy();

  setPage({ split: 'channel-pane', view: 'general' });

  await expectClosed();
});

it('stays open while the page only changes its search, as a filter does', () => {
  const { onOpenChange } = renderControlled();

  setPage({ split: 'front', view: 'notes', search: 'filter=open' });

  expect(onOpenChange).not.toHaveBeenCalledWith(false);
  expect(screen.getByRole('dialog', { name: 'Sheet' })).toBeTruthy();
});

it('stays open while its pane adopts the real id of what it shows', () => {
  const { onOpenChange } = renderControlled();

  setPage({ split: 'front', view: 'notes', id: 'provisioned-session' });

  expect(onOpenChange).not.toHaveBeenCalledWith(false);
  expect(screen.getByRole('dialog', { name: 'Sheet' })).toBeTruthy();
});

it('keeps a sheet the destination opens as it arrives', () => {
  const [open, setOpen] = createSignal(false);
  const onOpenChange = vi.fn(setOpen);
  render(() => <Sheet open={open()} onOpenChange={onOpenChange} />);

  // The navigation and the sheet's opening land in one update.
  batch(() => {
    setPage({ split: 'front', view: 'plans' });
    setOpen(true);
  });

  expect(onOpenChange).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: 'Sheet' })).toBeTruthy();
});

it('leaves the sheet open when its owner refuses, until the next navigation', () => {
  const { onOpenChange } = renderControlled({ refuseClose: true });

  setPage({ split: 'channel-pane', view: 'general' });
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole('dialog', { name: 'Sheet' })).toBeTruthy();

  // The page only changes its search: the owner isn't asked again.
  setPage({ split: 'channel-pane', view: 'general', search: 'message=1' });
  expect(onOpenChange).toHaveBeenCalledTimes(2);

  setPage({ split: 'front', view: 'notes' });
  expect(onOpenChange).toHaveBeenCalledTimes(3);
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
});

it('preserves the controlled half-height snap when navigation dismissal is refused', () => {
  const [point, setPoint] = createSignal<DrawerSnapPoint>(0.5);
  const onOpenChange = vi.fn();
  let drawer: ReturnType<typeof MobileDrawer.useContext> | undefined;
  const Content = () => {
    drawer = MobileDrawer.useContext();
    return <MobileDrawer.Content aria-label="Snapping sheet" />;
  };
  render(() => (
    <MobileDrawer
      open
      snapPoints={[0, 0.5, 1]}
      defaultSnapPoint={0.5}
      activeSnapPoint={point()}
      onActiveSnapPointChange={setPoint}
      onOpenChange={onOpenChange}
    >
      <Content />
    </MobileDrawer>
  ));
  expect(drawer?.activeSnapPoint()).toBe(0.5);

  setPage({ split: 'channel-pane', view: 'general' });

  expect(onOpenChange).toHaveBeenLastCalledWith(false);
  expect(drawer?.activeSnapPoint()).toBe(0.5);
  expect(screen.getByRole('dialog', { name: 'Snapping sheet' })).toBeTruthy();
});

it('keeps a sheet that opts out', async () => {
  const { onOpenChange } = renderControlled({ keepOpenOnNavigation: true });

  await closeSheetsForNavigation(async () => {
    setPage({ split: 'channel-pane', view: 'general' });
  });

  expect(onOpenChange).not.toHaveBeenCalledWith(false);
  expect(screen.getByRole('dialog', { name: 'Sheet' })).toBeTruthy();
});

it('closes for a navigation to the page already shown', async () => {
  const { onOpenChange } = renderControlled();

  await closeSheetsForNavigation(async () => {});

  expect(onOpenChange).toHaveBeenLastCalledWith(false);
  await expectClosed();
});

it('leaves a sheet opened during startup to its owner until a navigation closes it', async () => {
  setPage(undefined);
  const [open, setOpen] = createSignal(true);
  const onOpenChange = vi.fn(setOpen);
  render(() => (
    <Show when={open()}>
      <Sheet open onOpenChange={onOpenChange} />
    </Show>
  ));

  setPage({ split: 'home', view: 'home' });
  expect(onOpenChange).not.toHaveBeenCalled();

  await closeSheetsForNavigation(async () => {});
  await expectClosed();
});

it('asks again for another navigation while a notification tap is under way', async () => {
  const { onOpenChange } = renderControlled({ refuseClose: true });
  let land!: () => void;
  const landed = new Promise<void>((resolve) => {
    land = resolve;
  });

  const tap = closeSheetsForNavigation(() => landed);
  setPage({ split: 'channel-pane', view: 'general' });
  expect(onOpenChange).toHaveBeenCalledTimes(2);

  // An agent opens something else before the tap's navigation settles.
  setPage({ split: 'front', view: 'notes' });
  expect(onOpenChange).toHaveBeenCalledTimes(3);

  land();
  await tap;
});

it('asks an owner that refuses once per notification navigation', async () => {
  const { onOpenChange } = renderControlled({ refuseClose: true });

  // The tap asks first, then its navigation shows another page.
  await closeSheetsForNavigation(async () => {
    setPage({ split: 'channel-pane', view: 'general' });
  });
  expect(onOpenChange).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('dialog', { name: 'Sheet' })).toBeTruthy();

  setPage({ split: 'front', view: 'notes' });
  expect(onOpenChange).toHaveBeenCalledTimes(3);
});
