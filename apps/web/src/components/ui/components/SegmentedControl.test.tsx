import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';
import { TabsInset } from './TabsInset';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('preserves typed values and ignores disabled options', () => {
  const onChange = vi.fn();
  render(() => {
    const [value, setValue] = createSignal(1);
    return (
      <SegmentedControl
        value={value()}
        options={[
          { value: 1, label: 'First' },
          { value: 2, label: 'Second' },
          { value: 3, label: 'Unavailable', disabled: true },
        ]}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    );
  });
  fireEvent.click(screen.getByRole('radio', { name: 'Second' }));
  expect(onChange).toHaveBeenCalledExactlyOnceWith(2);
  expect(
    (screen.getByRole('radio', { name: 'Second' }) as HTMLInputElement).checked
  ).toBe(true);
  fireEvent.click(screen.getByText('Unavailable'));
  expect(onChange).toHaveBeenCalledTimes(1);
});

it('clears the selection for an external destination and allows returning', () => {
  const onChange = vi.fn();
  let selectExternal: () => void = () => {};
  render(() => {
    const [value, setValue] = createSignal('signal');
    selectExternal = () => setValue('');
    return (
      <SegmentedControl
        value={value()}
        options={[
          { value: 'signal', label: 'Signal' },
          { value: 'noise', label: 'Noise' },
        ]}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    );
  });
  selectExternal();
  const signal = screen.getByRole('radio', {
    name: 'Signal',
  }) as HTMLInputElement;
  const noise = screen.getByRole('radio', {
    name: 'Noise',
  }) as HTMLInputElement;
  expect(signal.checked).toBe(false);
  expect(noise.checked).toBe(false);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(noise);
  expect(noise.checked).toBe(true);
  expect(onChange).toHaveBeenCalledExactlyOnceWith('noise');
});

it('supports label clicks and disabled segments in the shared control', () => {
  const onChange = vi.fn();
  render(() => {
    const [value, setValue] = createSignal('all');
    return (
      <TabsInset
        aria-label="Conversations"
        value={value()}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        list={[
          { value: 'all', label: 'All' },
          { value: 'recent', label: 'Recent' },
          { value: 'disabled', label: 'Unavailable', disabled: true },
          { value: 'threads', label: 'Threads' },
        ]}
      />
    );
  });
  fireEvent.click(screen.getByText('Recent'));
  expect(onChange).toHaveBeenCalledExactlyOnceWith('recent');
  fireEvent.click(screen.getByText('Unavailable'));
  expect(onChange).toHaveBeenCalledTimes(1);
});
