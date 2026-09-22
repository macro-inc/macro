/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { chooseSelectOption, selectOptions } from '../tests/select-helpers';
import { SettingsSelect } from './settings-select';

describe('SettingsSelect', () => {
  it('uses the styled menu to select a value and mark the current option', () => {
    const onChange = vi.fn();
    render(() => {
      const [value, setValue] = createSignal('macro');
      return (
        <SettingsSelect
          label="Runtime"
          value={value()}
          options={[
            { id: 'macro', name: 'Macro AI' },
            { id: 'local', name: 'My laptop' },
          ]}
          onChange={(id) => {
            setValue(id);
            onChange(id);
          }}
        />
      );
    });
    const trigger = screen.getByLabelText('Runtime');
    expect(trigger.tagName).toBe('BUTTON');
    expect(
      selectOptions(trigger)
        .getByRole('option', { name: 'Macro AI' })
        .getAttribute('aria-selected')
    ).toBe('true');
    chooseSelectOption(trigger, 'My laptop');
    expect(onChange).toHaveBeenCalledWith('local');
    expect(trigger.textContent).toBe('My laptop');
  });

  it('disables the loading field', () => {
    render(() => (
      <SettingsSelect
        label="Default model"
        options={[]}
        disabled
        placeholder="Loading models…"
        onChange={() => {}}
      />
    ));
    const trigger = screen.getByLabelText('Default model');
    expect(trigger).toHaveProperty('disabled', true);
    expect(trigger.textContent).toBe('Loading models…');
    fireEvent.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
