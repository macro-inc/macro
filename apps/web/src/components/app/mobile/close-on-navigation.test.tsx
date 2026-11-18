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
import { MobileDrawer } from './MobileDrawer';

type Page = { split: string; type: string; id: string; params?: string };

const [page, setPage] = createSignal<Page | undefined>();

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
  setPage({ split: 'front', type: 'md', id: 'notes' });
  // Only the active split is read: which pane shows, and what it shows.
  setGlobalSplitManager({
    activeSplit: () => {
      const shown = page();
      if (!shown) return;
      return {
        id: shown.split,
        content: () => ({
          type: shown.type,
          id: shown.id,
          params: shown.params,
        }),
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

  setPage({ split: 'channel-pane', type: 'channel', id: 'general' });

  expect(onOpenChange).toHaveBeenLastCalledWith(false);
  await expectClosed();
});

it('closes when the pane under it shows other content', async () => {
  renderControlled();

  setPage({ split: 'front', type: 'md', id: 'plans' });

  await expectClosed();
});

it('closes an uncontrolled sheet', async () => {
  render(() => <Sheet />);
  fireEvent.click(screen.getByText('Open sheet'));
  expect(screen.getByRole('dialog', { name: 'Sheet' })).toBeTruthy();

  setPage({ split: 'channel-pane', type: 'channel', id: 'general' });

  await expectClosed();
});

it('stays open while the page only changes its search, as a filter does', () => {
  const { onOpenChange } = renderControlled();

  setPage({ split: 'front', type: 'md', id: 'notes', params: 'filter=open' });

  expect(onOpenChange).not.toHaveBeenCalledWith(false);
  expect(screen.getByRole('dialog', { name: 'Sheet' })).toBeTruthy();
});

it('keeps a sheet the destination opens as it arrives', () => {
  const [open, setOpen] = createSignal(false);
  const onOpenChange = vi.fn(setOpen);
  render(() => <Sheet open={open()} onOpenChange={onOpenChange} />);

  // The navigation and the sheet's opening land in one update.
  batch(() => {
    setPage({ split: 'front', type: 'md', id: 'plans' });
    setOpen(true);
  });

  expect(onOpenChange).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: 'Sheet' })).toBeTruthy();
});

it('leaves the sheet open when its owner refuses the close', () => {
  const { onOpenChange } = renderControlled({ refuseClose: true });

  setPage({ split: 'channel-pane', type: 'channel', id: 'general' });

  expect(onOpenChange).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole('dialog', { name: 'Sheet' })).toBeTruthy();
});

it('keeps a sheet that opts out', () => {
  const { onOpenChange } = renderControlled({ keepOpenOnNavigation: true });

  setPage({ split: 'channel-pane', type: 'channel', id: 'general' });
  closeSheetsForNavigation();

  expect(onOpenChange).not.toHaveBeenCalledWith(false);
  expect(screen.getByRole('dialog', { name: 'Sheet' })).toBeTruthy();
});

it('closes for a navigation to the page already shown', async () => {
  const { onOpenChange } = renderControlled();

  closeSheetsForNavigation();

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

  setPage({ split: 'home', type: 'component', id: 'home' });
  expect(onOpenChange).not.toHaveBeenCalled();

  closeSheetsForNavigation();
  await expectClosed();
});
