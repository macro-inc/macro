import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { ModelSelector, SessionModelSelector } from './ModelSelector';

const options = [
  { id: 'gpt-5', name: 'GPT-5', description: null, group: null },
  { id: 'claude-sonnet-4', name: 'Sonnet 4', description: null, group: null },
];

describe('shared model selector', () => {
  it('uses the shared pill and menu while switching a session model', () => {
    const select = vi.fn();
    const [changingTo, setChangingTo] = createSignal<string>();
    render(() => (
      <SessionModelSelector
        model="gpt-5"
        options={options}
        onSelect={select}
        changingTo={changingTo()}
      />
    ));
    const trigger = screen.getByRole('button', { name: 'Model' });
    expect(trigger.classList.contains('pill')).toBe(true);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: /Sonnet 4/ }));
    expect(select).toHaveBeenCalledWith('claude-sonnet-4');
    expect(screen.queryByRole('listbox')).toBeNull();
    setChangingTo('claude-sonnet-4');
    expect(trigger.textContent).toContain('Sonnet 4');
    expect(trigger.hasAttribute('disabled')).toBe(true);
    expect(trigger.getAttribute('aria-busy')).toBe('true');
  });

  it('preserves the new-chat default option in the same menu', () => {
    render(() => (
      <ModelSelector
        model="gpt-5"
        label="default (GPT-5)"
        options={options.map((option) => ({ ...option, provider: 'openai' }))}
        onSelect={vi.fn()}
      >
        {(close) => (
          <button role="option" onClick={close}>
            Agent default
          </button>
        )}
      </ModelSelector>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Model' }));
    expect(screen.getByRole('option', { name: 'Agent default' })).toBeTruthy();
    expect(screen.getByRole('option', { name: /GPT-5/ })).toBeTruthy();
  });
});
