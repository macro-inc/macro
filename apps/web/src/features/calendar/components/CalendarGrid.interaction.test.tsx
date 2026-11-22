// @vitest-environment jsdom
import { cleanup, render } from '@solidjs/testing-library';
import { createSnapPager } from '@ui/components/SnapPager';
import { afterEach, expect, it, vi } from 'vitest';
import { CalendarGrid, type CalendarGridHandle } from './CalendarGrid';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each(['drag', 'resize'] as const)(
  'locks native paging during event %s and unlocks after stop or disposal',
  async (kind) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    const pager = createSnapPager();
    let handle: CalendarGridHandle | undefined;
    render(() => (
      <CalendarGrid
        initialDate={new Date(2030, 0, 1)}
        events={[]}
        eventsById={new Map()}
        settings={{
          initialView: 'timeGridDay',
          showWeekends: true,
          weekStartsOn: 0,
          timeFormat: '24-hour',
          useNarrowDayHeaders: false,
          useNarrowEventContent: false,
        }}
        selection={{ color: 'orange' }}
        onEventInteractionChange={pager.setLocked}
      >
        {(value) => {
          handle = value;
          return null;
        }}
      </CalendarGrid>
    ));
    const api = handle?.api();
    if (!api) throw new Error('Calendar did not mount');
    const event = api.addEvent({
      title: 'Event',
      start: '2030-01-01T10:00:00',
    });
    if (!event) throw new Error('Event did not mount');
    const args = {
      event,
      el: document.createElement('div'),
      jsEvent: new MouseEvent('mousedown'),
      view: api.view,
    };
    const start =
      kind === 'drag'
        ? api.getOption('eventDragStart')
        : api.getOption('eventResizeStart');
    const stop =
      kind === 'drag'
        ? api.getOption('eventDragStop')
        : api.getOption('eventResizeStop');
    start?.(args);
    expect(pager.locked()).toBe(true);
    pager.next();
    expect(pager.position()).toBe(0);
    stop?.(args);
    await Promise.resolve();
    expect(pager.locked()).toBe(false);
    pager.next();
    expect(pager.position()).toBe(1);
    start?.(args);
    cleanup();
    expect(pager.locked()).toBe(false);
  }
);
