import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { useOpenEventComposer } from './use-open-event-composer';

const source = vi.hoisted(() => ({
  touch: true,
  openHost: vi.fn(async () => {}),
  openDrawer: vi.fn<(...args: unknown[]) => void>(),
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
    useOpenEventComposer()();
    expect(source.openHost).not.toHaveBeenCalled();
    expect(source.openDrawer).toHaveBeenCalledOnce();
    expect(source.openDrawer.mock.calls[0][0]).toMatchObject({
      type: 'component',
      id: 'calendar-event-compose',
    });
    dispose();
  });
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
