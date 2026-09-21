// @vitest-environment jsdom
import { createMemoryHistory, MemoryRouter, Route } from '@solidjs/router';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { CalendarNavigation } from '../calendar-home/components/calendar-navigation';
import { useCalendarHomeNavigation } from './use-calendar-home-navigation';

afterEach(cleanup);

it('restores both destinations from URL history and preserves other parameters', async () => {
  const history = createMemoryHistory();
  history.set({
    value: '/calendar?calendarView=calls&other=kept',
    replace: true,
  });
  function Page() {
    const state = useCalendarHomeNavigation(true);
    return (
      <CalendarNavigation
        tab={state.tab()}
        callsEnabled
        onTabChange={state.navigateView}
        onCreate={() => {}}
        createMenu={<span />}
      />
    );
  }
  render(() => (
    <MemoryRouter history={history}>
      <Route path="/calendar" component={Page} />
    </MemoryRouter>
  ));
  const active = (label: string) =>
    expect(
      screen.getByRole('button', { name: label }).getAttribute('aria-current')
    ).toBe('page');
  active('Calls');
  fireEvent.click(screen.getByRole('button', { name: 'Events' }));
  await vi.waitFor(() => active('Events'));
  expect(history.get()).toContain('calendarView=events');
  expect(history.get()).toContain('other=kept');
  history.back();
  await vi.waitFor(() => active('Calls'));
  history.forward();
  await vi.waitFor(() => active('Events'));
});
