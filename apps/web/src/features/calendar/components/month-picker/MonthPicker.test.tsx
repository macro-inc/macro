import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { Portal } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonthPickerPopover } from './MonthPickerPopover';

vi.mock('@core/component/ScopedPortal', () => ({
  ScopedPortal: (props: ParentProps) => <Portal>{props.children}</Portal>,
}));

afterEach(cleanup);

describe('month picker focus lifecycle', () => {
  it('mounts the open focus scope and returns focus on Escape', async () => {
    render(() => {
      const [open, setOpen] = createSignal(false);
      return (
        <MonthPickerPopover
          date={new Date(2026, 10, 13)}
          open={open()}
          onOpenChange={setOpen}
          onSelect={() => {}}
          focusDateEntry
        />
      );
    });
    const trigger = screen.getByRole('button', { name: 'Choose month' });
    fireEvent.click(trigger);
    const input = screen.getByLabelText('Go to date');
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
