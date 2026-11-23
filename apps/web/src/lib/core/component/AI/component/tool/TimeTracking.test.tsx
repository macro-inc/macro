import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { Component, JSX, ParentProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatMinutes, timeTrackingHandlers } from './TimeTracking';

vi.mock('@core/component/ItemPreview', () => ({
  ItemPreview: (props: { id: string }) => <span>task {props.id}</span>,
}));
vi.mock('@ui', () => ({
  Layer: (props: ParentProps) => props.children,
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
      type="button"
      onClick={props.onClick}
      aria-expanded={props['aria-expanded']}
    >
      {props.children}
    </button>
  ),
}));
afterEach(() => {
  cleanup();
});

const taskId = '01a1fa5b-0000-7000-8000-000000000001';

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: '01a1fa5b-0000-7000-8000-0000000000e1',
    userId: 'macro|logger@example.com',
    date: '2026-11-20',
    minutes: 90,
    note: 'Review',
    source: 'manual',
    ...overrides,
  };
}

function tool(
  name: keyof typeof timeTrackingHandlers,
  data: unknown,
  response?: unknown
) {
  return render(() => (
    <Dynamic
      component={
        timeTrackingHandlers[name].render as Component<Record<string, unknown>>
      }
      tool={{ name, data }}
      response={response === undefined ? undefined : { name, data: response }}
      renderContext={{
        isStreaming: response === undefined,
        grouped: false,
        followedBy: () => false,
      }}
    />
  ));
}

describe('formatMinutes', () => {
  it('writes a length the way the Time pill does', () => {
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(275)).toBe('4h 35m');
  });
});

describe('LogTime row', () => {
  it('names the length and task, and opens on the saved entry', () => {
    tool(
      'LogTime',
      { task_id: taskId, minutes: 90, date: '2026-11-20' },
      {
        entry: entry(),
        totalMinutes: 135,
        summary:
          "Logged 1h 30m on 2026-11-20; the task's Time logged is now 2h 15m.",
      }
    );

    expect(screen.getByText('1h 30m')).toBeTruthy();
    expect(screen.getByText(`task ${taskId}`)).toBeTruthy();
    expect(screen.getByText('2h 15m total')).toBeTruthy();

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('logger@example.com')).toBeTruthy();
    expect(screen.getByText('Review')).toBeTruthy();
    expect(
      screen.getByText(/the task's Time logged is now 2h 15m/)
    ).toBeTruthy();
  });

  it('shows no status while the call runs', () => {
    tool('LogTime', { task_id: taskId, minutes: 30, date: '2026-11-20' });

    expect(screen.getByText('30m')).toBeTruthy();
    expect(screen.queryByText(/total/)).toBeNull();
  });
});

describe('ReadTimeEntries row', () => {
  it('lists every returned entry with who logged it', () => {
    tool(
      'ReadTimeEntries',
      { task_id: taskId },
      {
        totalMinutes: 150,
        entries: [
          entry(),
          entry({
            id: '01a1fa5b-0000-7000-8000-0000000000e2',
            userId: 'macro|teammate@example.com',
            minutes: 60,
            note: null,
            source: 'timer',
          }),
        ],
        truncated: false,
        summary: '2h 30m logged in 2 entries.',
      }
    );

    expect(screen.getByText('2h 30m logged')).toBeTruthy();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('logger@example.com')).toBeTruthy();
    expect(screen.getByText('teammate@example.com')).toBeTruthy();
    expect(screen.getByText('2h 30m logged in 2 entries.')).toBeTruthy();
  });

  it('says when nothing was logged', () => {
    tool(
      'ReadTimeEntries',
      { task_id: taskId },
      {
        totalMinutes: 0,
        entries: [],
        truncated: false,
        summary: 'No time has been logged on this task.',
      }
    );

    expect(screen.getByText('No time logged')).toBeTruthy();
  });
});
