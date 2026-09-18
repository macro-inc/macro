// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { MeetingCallHeading } from './meeting-call-heading';

describe('in-call heading', () => {
  it('keeps the title read-only without the owner capability', () => {
    render(() => <MeetingCallHeading title="Design review" />);
    expect(screen.getByRole('heading').textContent).toBe('Design review');
    expect(screen.queryByRole('button', { name: 'Rename call' })).toBeNull();
  });

  it('lets owners save a name and cancel a later edit', async () => {
    const [title, setTitle] = createSignal('Design review');
    const rename = vi.fn(async (value: string) => {
      setTitle(value);
    });
    render(() => <MeetingCallHeading title={title()} onRename={rename} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename call' }));
    const input = screen.getByRole('textbox', { name: 'Call name' });
    expect(document.activeElement).toBe(input);
    fireEvent.input(input, { target: { value: '  Team sync  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(rename).toHaveBeenCalledExactlyOnceWith('Team sync');
    expect(screen.getByRole('heading').textContent).toBe('Team sync');
    fireEvent.click(screen.getByRole('button', { name: 'Rename call' }));
    fireEvent.input(screen.getByRole('textbox'), {
      target: { value: 'Discard' },
    });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(rename).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading').textContent).toBe('Team sync');
  });

  it('keeps the draft on a save failure and prevents blank names', async () => {
    const rename = vi.fn(async () => {
      throw new Error('Network failure');
    });
    render(() => (
      <MeetingCallHeading title="Design review" onRename={rename} />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Rename call' }));
    fireEvent.input(screen.getByRole('textbox'), { target: { value: ' ' } });
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty(
      'disabled',
      true
    );
    fireEvent.input(screen.getByRole('textbox'), {
      target: { value: 'New name' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'New name');
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty(
      'disabled',
      false
    );
  });

  it('shows the current local time, updates it, and cleans up when unmounted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 20, 12, 15));
    try {
      const view = render(() => <MeetingCallHeading title="Design review" />);
      expect(screen.getByLabelText('Current time').textContent).toBe(
        new Date(2026, 8, 20, 12, 15).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        })
      );
      vi.advanceTimersByTime(60_000);
      expect(screen.getByLabelText('Current time').textContent).toBe(
        new Date(2026, 8, 20, 12, 16).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        })
      );
      view.unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
