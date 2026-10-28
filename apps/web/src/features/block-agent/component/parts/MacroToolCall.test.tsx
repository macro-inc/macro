/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { MacroToolCall } from './MacroToolCall';
import type { ToolCallContext } from './shared';

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));

const context: ToolCallContext = {
  sessionId: 'session',
  messageId: 'session:0:agent',
  partIndex: 0,
  inFlight: false,
  followedBy: () => false,
};

describe('MacroToolCall failures', () => {
  it('shows a failed call on its own card and reveals the reason on request', () => {
    const reason =
      'The calendar event no longer exists: it was deleted or cancelled, or the id is not a calendar event.';
    render(() => (
      <MacroToolCall
        detail={{
          kind: 'macro',
          input: { eventId: '01a16cb6-0000-7000-8000-00000000dead' },
          output: reason,
          error: reason,
        }}
        common={{
          id: 'call-1',
          label: 'ReadCalendarEvent',
          status: 'failed',
          muted: true,
          stopped: false,
          trailing: 'Failed',
        }}
        context={context}
      />
    ));

    expect(screen.getByText('Read calendar event')).toBeTruthy();
    expect(screen.queryByText('ReadCalendarEvent')).toBeNull();
    expect(screen.queryByText(reason)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));

    expect(screen.getByText(reason)).toBeTruthy();
  });
});

describe('MacroToolCall unfinished calls', () => {
  const readEvent = {
    kind: 'macro' as const,
    input: { eventId: '01a16cb6-0000-7000-8000-000000000001' },
    output: null,
    error: null,
  };

  it('shows a running call by its own label while it runs', () => {
    render(() => (
      <MacroToolCall
        detail={readEvent}
        common={{
          id: 'call-1',
          label: 'ReadCalendarEvent',
          status: 'running',
          muted: false,
          stopped: false,
          trailing: undefined,
        }}
        context={{ ...context, inFlight: true }}
      />
    ));

    expect(screen.getByText('Read calendar event')).toBeTruthy();
    expect(screen.queryByText('ReadCalendarEvent')).toBeNull();
    expect(screen.queryByText('Failed')).toBeNull();
  });

  it('says a call cut off by its turn was stopped, by its own label', () => {
    render(() => (
      <MacroToolCall
        detail={readEvent}
        common={{
          id: 'call-1',
          label: 'ReadCalendarEvent',
          status: 'completed',
          muted: false,
          stopped: true,
          trailing: 'Stopped',
        }}
        context={context}
      />
    ));

    expect(screen.getByText('Read calendar event')).toBeTruthy();
    expect(screen.getByText('Stopped')).toBeTruthy();
    expect(screen.queryByText('Failed')).toBeNull();
  });

  it("shows a running call's latest arguments when the harness replaces them", () => {
    const [query, setQuery] = createSignal('first draft');
    render(() => (
      <MacroToolCall
        detail={{
          kind: 'macro',
          input: { input: query() },
          output: null,
          error: null,
        }}
        common={{
          id: 'call-1',
          label: 'WebSearch',
          status: 'running',
          muted: false,
          stopped: false,
          trailing: undefined,
        }}
        context={{ ...context, inFlight: true }}
      />
    ));
    expect(screen.getByText('first draft')).toBeTruthy();

    setQuery('launch checklist');

    expect(screen.getByText('launch checklist')).toBeTruthy();
    expect(screen.queryByText('first draft')).toBeNull();
  });

  it('keeps a running call whose arguments are still arriving on the summary row', () => {
    render(() => (
      <MacroToolCall
        detail={{ ...readEvent, input: {} }}
        common={{
          id: 'call-1',
          label: 'ReadCalendarEvent',
          status: 'running',
          muted: false,
          stopped: false,
          trailing: undefined,
        }}
        context={{ ...context, inFlight: true }}
      />
    ));

    expect(screen.getAllByText('ReadCalendarEvent').length).toBeGreaterThan(0);
    expect(screen.queryByText('Read calendar event')).toBeNull();
  });
});
