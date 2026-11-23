import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal, type ParentProps } from 'solid-js';
import { Portal } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MonthYearPicker } from './MonthPicker';
import { MonthYearPickerPopover } from './MonthPickerPopover';

vi.mock('@core/component/ScopedPortal', () => ({
  ScopedPortal: (props: ParentProps) => <Portal>{props.children}</Portal>,
}));
beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const TODAY = new Date(2026, 10, 13);
function inline(onChange = vi.fn(), onKeyDown = vi.fn()) {
  render(() => (
    <div onKeyDown={onKeyDown}>
      <MonthYearPicker
        value={TODAY}
        today={TODAY}
        initialFocus="none"
        onChange={onChange}
      >
        <MonthYearPicker.Header />
        <MonthYearPicker.Grid />
        <MonthYearPicker.Footer />
      </MonthYearPicker>
    </div>
  ));
  return { onChange, onKeyDown };
}
it('moves the same month by PageUp/PageDown and ten years with Shift', async () => {
  inline();
  let month = screen.getByRole('button', { name: 'November 2026' });
  month.focus();
  fireEvent.keyDown(month, { key: 'PageUp' });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'November 2025' })
    )
  );
  fireEvent.keyDown(document.activeElement!, {
    key: 'PageDown',
    shiftKey: true,
  });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'November 2035' })
    )
  );
  fireEvent.keyDown(document.activeElement!, { key: 'PageUp', shiftKey: true });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'November 2025' })
    )
  );
});
it('opens the year grid with Enter and pages twelve years even with Shift', async () => {
  inline();
  const user = userEvent.setup();
  screen.getByRole('button', { name: 'Choose year' }).focus();
  await user.keyboard('{Enter}');
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '2026' })
    )
  );
  fireEvent.keyDown(document.activeElement!, {
    key: 'PageDown',
    shiftKey: true,
  });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '2038' })
    )
  );
  await user.keyboard('{Enter}');
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'November 2038' })
    )
  );
});
it('handles T locally and Today only browses without selecting', async () => {
  const { onChange, onKeyDown } = inline();
  expect(
    screen.getByRole('button', { name: 'Today' }).hasAttribute('disabled')
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Next year' }));
  expect(
    screen.getByRole('button', { name: 'Today' }).hasAttribute('disabled')
  ).toBe(false);
  fireEvent.keyDown(screen.getByRole('button', { name: 'November 2027' }), {
    key: 't',
  });
  expect(onKeyDown).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'November 2026' })
    )
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next year' }));
  fireEvent.click(screen.getByRole('button', { name: 'Today' }));
  expect(
    screen.getByRole('button', { name: 'Today' }).hasAttribute('disabled')
  ).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
});
it('returns from years with Escape before closing, then restores the trigger', async () => {
  render(() => {
    const [open, setOpen] = createSignal(false);
    return (
      <MonthYearPickerPopover
        value={TODAY}
        today={TODAY}
        open={open()}
        onOpenChange={setOpen}
        triggerSize="md"
        onChange={vi.fn()}
      >
        Month
      </MonthYearPickerPopover>
    );
  });
  const trigger = screen.getByRole('button', { name: 'Choose month' });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Choose year' }));
  fireEvent.keyDown(screen.getByRole('button', { name: '2026' }), {
    key: 'Escape',
  });
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'November 2026' })
    )
  );
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});
it('focuses Go to date when requested and keeps invalid input open', async () => {
  render(() => {
    const [open, setOpen] = createSignal(false);
    return (
      <MonthYearPickerPopover
        value={TODAY}
        open={open()}
        onOpenChange={setOpen}
        triggerSize="md"
        focusGoToDate
        onChange={vi.fn()}
      >
        Month
      </MonthYearPickerPopover>
    );
  });
  fireEvent.click(screen.getByRole('button', { name: 'Choose month' }));
  const input = screen.getByLabelText<HTMLInputElement>('Go to date');
  expect(input.type).toBe('date');
  await waitFor(() => expect(document.activeElement).toBe(input));
  fireEvent.input(input, { target: { value: 'not a date' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(input.value).toBe('');
});

it('closes from Go to date even while the year grid is open', async () => {
  render(() => {
    const [open, setOpen] = createSignal(false);
    return (
      <MonthYearPickerPopover
        value={TODAY}
        open={open()}
        onOpenChange={setOpen}
        triggerSize="md"
        onChange={vi.fn()}
      >
        Month
      </MonthYearPickerPopover>
    );
  });
  const trigger = screen.getByRole('button', { name: 'Choose month' });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Choose year' }));
  const input = screen.getByLabelText('Go to date');
  input.focus();
  fireEvent.keyDown(input, { key: 'Escape' });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});

it('preserves grid focus when an inline host changes its value', async () => {
  let update!: (value: Date) => void;
  render(() => {
    const [value, setValue] = createSignal(TODAY);
    update = setValue;
    return (
      <MonthYearPicker value={value()} onChange={setValue} initialFocus="none">
        <MonthYearPicker.Header />
        <MonthYearPicker.Grid />
        <MonthYearPicker.Footer />
      </MonthYearPicker>
    );
  });
  fireEvent.click(screen.getByRole('button', { name: 'Choose year' }));
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '2026' })
    )
  );
  update(new Date(2034, 5, 1));
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'June 2034' })
    )
  );
});

it('supports Home, End, cross-year arrows and Space selection in the month grid', async () => {
  const { onChange } = inline();
  const user = userEvent.setup();
  screen.getByRole('button', { name: 'November 2026' }).focus();
  await user.keyboard('{Home}');
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'January 2026' })
  );
  await user.keyboard('{End}{ArrowRight}');
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'January 2027' })
  );
  await user.keyboard('{ArrowUp}');
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'September 2026' })
  );
  await user.keyboard(' ');
  expect(onChange).toHaveBeenCalledExactlyOnceWith(new Date(2026, 8, 1));
});

it('keeps Tab focus inside the popover including its footer', async () => {
  render(() => {
    const [open, setOpen] = createSignal(false);
    return (
      <>
        <button>Outside</button>
        <MonthYearPickerPopover
          value={new Date(2031, 2, 1)}
          today={TODAY}
          open={open()}
          onOpenChange={setOpen}
          triggerSize="md"
          onChange={vi.fn()}
        >
          Month
        </MonthYearPickerPopover>
      </>
    );
  });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Choose month' }));
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'March 2031' })
    )
  );
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Today' })
  );
  await user.tab();
  expect(document.activeElement).toBe(screen.getByLabelText('Go to date'));
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Choose year' })
  );
});
