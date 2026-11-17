import { createDayDraftRange } from '@app/features/calendar/primitives/create-day-draft-range';
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { useOpenEventComposer } from './use-open-event-composer';

const source = vi.hoisted(() => ({
  touch: true,
  openHost: vi.fn(async () => {}),
  openDrawer:
    vi.fn<
      (
        content: unknown,
        options: { onClose: (close: () => void) => Promise<void> }
      ) => void
    >(),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => source.touch,
}));
vi.mock(
  '@app/features/calendar/context/calendar-composer-host-context',
  () => ({
    useCalendarComposerHost: () => ({ open: source.openHost }),
  })
);
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ popoverSplit: source.openDrawer }),
}));
afterEach(() => vi.clearAllMocks());

it('uses the drawer on touch even inside a workspace with a desktop composer host', () => {
  source.touch = true;
  createRoot((dispose) => {
    useOpenEventComposer()({ initialDrawerHeight: 42 });
    expect(source.openHost).not.toHaveBeenCalled();
    expect(source.openDrawer).toHaveBeenCalledOnce();
    expect(source.openDrawer.mock.calls[0][0]).toMatchObject({
      type: 'component',
      id: 'calendar-event-compose',
      params: { initialDrawerHeight: 42 },
    });
    dispose();
  });
});

it('forwards only the Day-slot binding to the touch drawer and retains close cleanup', async () => {
  const { options, close, onClose, dispose } = createRoot((dispose) => {
    source.touch = true;
    const draft = createDayDraftRange({
      start: new Date('2030-07-01T10:00:00Z'),
      end: new Date('2030-07-01T11:00:00Z'),
    });
    const onClose = vi.fn();
    useOpenEventComposer()({ dayDraftRange: draft, onClose });
    expect(source.openDrawer.mock.calls[0]?.[0]).toMatchObject({
      params: { dayDraftRange: draft },
    });
    const options = source.openDrawer.mock.calls[0]?.[1];
    const close = vi.fn();
    return { options, close, onClose, dispose };
  });
  await options?.onClose(close);
  expect(onClose).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  dispose();
});

it('uses the workspace composer host for desktop input', () => {
  source.touch = false;
  createRoot((dispose) => {
    useOpenEventComposer()();
    expect(source.openHost).toHaveBeenCalledOnce();
    expect(source.openDrawer).not.toHaveBeenCalled();
    dispose();
  });
});
