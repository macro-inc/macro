import { cleanup, render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectTimeEntry } from './project-time';

const flag = vi.hoisted(() => ({ enabled: true }));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: flag.enabled, loading: false }),
}));
vi.mock('@app/features/calendar/utils/preferences', () => ({
  useCalendarPreferences: () => [{ weekStartsOn: 0 }],
}));
vi.mock('./time-tracking-provider', () => ({
  TimeTrackingProvider: (props: ParentProps) => props.children,
}));
vi.mock('./views/mobile/project-time', () => ({
  MobileProjectTime: () => <p>Phone time row</p>,
}));

afterEach(() => {
  cleanup();
  flag.enabled = true;
});

it('shows the phone Time row only with time tracking on', () => {
  render(() => (
    <ProjectTimeEntry
      project={{ id: 'project-1', name: 'Launch plans' }}
      onOpenTask={() => true}
    />
  ));
  expect(screen.getByText('Phone time row')).toBeTruthy();
  cleanup();

  flag.enabled = false;
  render(() => (
    <ProjectTimeEntry
      project={{ id: 'project-1', name: 'Launch plans' }}
      onOpenTask={() => true}
    />
  ));
  expect(screen.queryByText('Phone time row')).toBeNull();
});
