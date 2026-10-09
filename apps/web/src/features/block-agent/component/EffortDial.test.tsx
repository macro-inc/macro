/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SelectSessionConfigOption } from '../state/session-config';
import { EffortDial } from './EffortDial';

const config: SelectSessionConfigOption = {
  id: 'runtime_effort',
  name: 'Effort',
  description: null,
  category: 'thought_level',
  type: 'select',
  currentValue: 'balanced',
  options: [
    { value: 'quick', name: 'Low', description: null, group: null },
    { value: 'balanced', name: 'Medium', description: null, group: null },
    { value: 'deep', name: 'High', description: null, group: null },
  ],
};
afterEach(cleanup);
describe('EffortDial', () => {
  it('cycles opaque runtime values and wraps at the highest level', () => {
    const change = vi.fn();
    render(() => {
      const [value, setValue] = createSignal<string>();
      return (
        <EffortDial
          config={config}
          value={value()}
          onChange={(choice) => {
            change(choice);
            setValue(choice.value);
          }}
        />
      );
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Reasoning effort: Medium' })
    );
    expect(change).toHaveBeenLastCalledWith({
      configId: 'runtime_effort',
      value: 'deep',
      name: 'High',
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Reasoning effort: High' })
    );
    expect(change).toHaveBeenLastCalledWith({
      configId: 'runtime_effort',
      value: 'quick',
      name: 'Low',
    });
    fireEvent.keyDown(screen.getByRole('button'), { key: 'End' });
    expect(
      screen.getByRole('button', { name: 'Reasoning effort: High' })
    ).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowLeft' });
    expect(
      screen.getByRole('button', { name: 'Reasoning effort: Medium' })
    ).toBeTruthy();
  });
  it('does not change a disabled configuration', () => {
    const change = vi.fn();
    render(() => <EffortDial config={config} disabled onChange={change} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.keyDown(screen.getByRole('button'), { key: 'End' });
    expect(change).not.toHaveBeenCalled();
  });
  it('hides the dial when effort is unsupported', () => {
    render(() => <EffortDial onChange={() => {}} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
