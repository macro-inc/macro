import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutomationTimePicker } from './AutomationTimePicker';

vi.mock('@core/directive/clickOutside', () => ({
  default: () => {},
}));

afterEach(cleanup);

function ControlledPicker(props: { initial?: string }) {
  const [value, setValue] = createSignal(props.initial ?? '09:00');
  return (
    <AutomationTimePicker value={value()} onChange={(next) => setValue(next)} />
  );
}

describe('AutomationTimePicker', () => {
  it('lets the user type a two-digit minute without re-padding mid-keystroke', async () => {
    render(() => <ControlledPicker initial="09:00" />);

    fireEvent.click(screen.getByRole('button'));
    const minute = screen.getByLabelText('Minute') as HTMLInputElement;

    expect(minute.value).toBe('00');

    fireEvent.input(minute, { target: { value: '3' } });
    expect(minute.value).toBe('3');

    fireEvent.input(minute, { target: { value: '30' } });
    expect(minute.value).toBe('30');

    fireEvent.blur(minute);
    expect(minute.value).toBe('30');
  });

  it('lets the user backspace a minute digit without restoring padding', async () => {
    render(() => <ControlledPicker initial="09:30" />);

    fireEvent.click(screen.getByRole('button'));
    const minute = screen.getByLabelText('Minute') as HTMLInputElement;

    expect(minute.value).toBe('30');

    fireEvent.input(minute, { target: { value: '3' } });
    expect(minute.value).toBe('3');

    fireEvent.input(minute, { target: { value: '' } });
    expect(minute.value).toBe('');
  });

  it('still pads minutes on blur', async () => {
    render(() => <ControlledPicker initial="09:00" />);

    fireEvent.click(screen.getByRole('button'));
    const minute = screen.getByLabelText('Minute') as HTMLInputElement;

    fireEvent.input(minute, { target: { value: '5' } });
    expect(minute.value).toBe('5');

    fireEvent.blur(minute);
    expect(minute.value).toBe('05');
  });
});
