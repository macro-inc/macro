/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { UpcomingCalendarEvent } from '../core/upcoming-calendar-events';
import { CallSidebar } from './call-sidebar';

vi.mock('@ui', () => ({
  Tooltip: (props: { children: JSX.Element }) => <>{props.children}</>,
}));

const event: UpcomingCalendarEvent = {
  id: '["event-1","occurrence-1"]',
  eventId: 'event-1',
  occurrenceKey: 'occurrence-1',
  title: 'Planning',
  color: '#ff0000',
  start: '2026-01-15T10:00:00Z',
  end: '2026-01-15T11:00:00Z',
  allDay: false,
};

afterEach(cleanup);

it('marks the selected upcoming event active without changing its join action', () => {
  const openEvent = vi.fn();
  const join = vi.fn();
  const { getByRole } = render(() => (
    <CallSidebar
      active={[]}
      upcoming={[{ ...event, url: 'https://example.com/meet' }]}
      upcomingLoading={false}
      selectedEventId={event.id}
      when={() => '10:00 AM'}
      canJoin={() => true}
      onOpenEvent={openEvent}
      onJoin={join}
      onRetryActive={vi.fn()}
      onRetryUpcoming={vi.fn()}
    />
  ));
  const row = getByRole('button', { name: 'Open Planning' });
  expect(row.getAttribute('aria-current')).toBe('true');
  expect(row.parentElement?.classList.contains('bg-active')).toBe(true);
  fireEvent.click(row);
  expect(openEvent).toHaveBeenCalledWith(expect.objectContaining({ id: event.id }), row);
  fireEvent.click(getByRole('button', { name: 'Join Planning' }));
  expect(join).toHaveBeenCalledWith('https://example.com/meet');
});

it('staggers small changes and coordinates larger replacements', async () => {
  const [upcoming, setUpcoming] = createSignal([
    event,
    { ...event, id: '["event-2","occurrence-2"]', title: 'Review' },
  ]);
  const animations: Array<{ onfinish: (() => void) | null }> = [];
  const delays: number[] = [];
  const durations: number[] = [];
  const frames: unknown[] = [];
  const animate = vi.fn(
    (keyframes: unknown, options: { delay: number; duration: number }) => {
      const animation = { onfinish: null as (() => void) | null };
      animations.push(animation);
      frames.push(keyframes);
      delays.push(options.delay);
      durations.push(options.duration);
      return animation;
    }
  );
  const previousAnimate = HTMLElement.prototype.animate;
  const previousMatchMedia = window.matchMedia;
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: animate,
  });
  window.matchMedia = vi.fn(() => ({ matches: false })) as typeof window.matchMedia;
  try {
    const { container } = render(() => (
      <CallSidebar
        active={[]}
        upcoming={upcoming()}
        upcomingLoading={false}
        when={() => '10:00 AM'}
        canJoin={() => false}
        onOpenEvent={vi.fn()}
        onJoin={vi.fn()}
        onRetryActive={vi.fn()}
        onRetryUpcoming={vi.fn()}
      />
    ));
    setUpcoming([]);
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(2));
    expect(delays).toEqual([0, 55]);
    expect(screen.queryByText('No upcoming events')).toBeNull();
    for (const animation of animations) animation.onfinish?.();
    await waitFor(() =>
      expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
    );
    expect(screen.getByText('No upcoming events')).toBeTruthy();
    setUpcoming([
      event,
      { ...event, id: '["event-2","occurrence-2"]', title: 'Review' },
    ]);
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(4));
    expect(delays).toEqual([0, 55, 0, 55]);
    expect((frames[2] as Keyframe[])[0]?.height).toBe('0px');
    expect((frames[2] as Keyframe[])[0]?.transform).toBe('translateX(-100%)');
    expect((frames[2] as Keyframe[])[1]?.transform).toBe('translateX(0)');
    for (const animation of animations.slice(2)) animation.onfinish?.();
    expect(screen.getByRole('button', { name: 'Open Planning' })).toBeTruthy();
    setUpcoming([
      { ...event, id: '["event-3","occurrence-3"]', title: 'Notes' },
      { ...event, id: '["event-2","occurrence-2"]', title: 'Review' },
    ]);
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(6));
    const replacementExit = (frames.slice(4) as Keyframe[][]).find(
      (keyframes) => keyframes.length === 3
    );
    expect(replacementExit?.[1]?.transform).toBe('translateX(100%)');
    expect(delays.slice(4)).toEqual([150, 0]);
    expect(
      container.querySelector('button[aria-label="Open Notes"]')?.parentElement
        ?.style.height
    ).toBe('0px');
    for (const animation of animations.slice(4)) animation.onfinish?.();
    expect(screen.getByRole('button', { name: 'Open Notes' })).toBeTruthy();
    const firstBatch = Array.from({ length: 5 }, (_, index) => ({
      ...event,
      id: `batch-${index}`,
      title: `Batch ${index}`,
    }));
    setUpcoming(firstBatch);
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(13));
    for (const animation of animations.slice(6)) animation.onfinish?.();

    setUpcoming(firstBatch.map((item) => ({ ...item, id: `next-${item.id}` })));
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(23));
    expect(delays.slice(13, 18)).toEqual([0, 12, 24, 24, 24]);
    expect(delays.slice(18, 23)).toEqual([0, 12, 24, 24, 24]);
    expect(durations.slice(13, 18)).toEqual(Array(5).fill(300));
    expect(durations.slice(18, 23)).toEqual(Array(5).fill(180));
    expect((frames[13] as Keyframe[])[1]?.opacity).toBe(0);
    expect((frames[13] as Keyframe[])[1]?.offset).toBe(0.45);
    for (const animation of animations.slice(13)) animation.onfinish?.();

    setUpcoming([]);
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(28));
    expect(delays.slice(23, 28)).toEqual([0, 12, 24, 24, 24]);
    expect(durations.slice(23, 28)).toEqual(Array(5).fill(180));
    for (const animation of animations.slice(23)) animation.onfinish?.();

    setUpcoming(firstBatch);
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(33));
    expect(delays.slice(28, 33)).toEqual([0, 12, 24, 24, 24]);
    expect(durations.slice(28, 33)).toEqual(Array(5).fill(180));
    for (const animation of animations.slice(28)) animation.onfinish?.();
  } finally {
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: previousAnimate,
    });
    window.matchMedia = previousMatchMedia;
  }
});
