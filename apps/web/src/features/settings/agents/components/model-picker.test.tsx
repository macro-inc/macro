import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentModel } from '../core/types';
import { AgentModelPicker } from './model-picker';

vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
vi.mock('@core/component/AI/component/input/ModelCatalogPicker', () => ({
  ModelCatalogPicker: () => null,
}));

afterEach(cleanup);

describe('AgentModelPicker', () => {
  it.each([false, true])(
    'keeps the selected model when refreshed options have new identities (reordered=%s)',
    (reordered) => {
      const initial: AgentModel[] = [
        { id: 'balanced', name: 'Balanced' },
        { id: 'reasoning', name: 'Reasoning' },
        { id: 'fast', name: 'Fast' },
      ];
      const [models, setModels] = createSignal(initial);
      const [value, setValue] = createSignal('balanced');
      const onChange = vi.fn((id: string) => setValue(id));
      render(() => (
        <AgentModelPicker
          catalog={{ state: 'available', models: models() }}
          models={models()}
          value={value()}
          runtimeName="Macro"
          onChange={onChange}
          onRetry={() => {}}
        />
      ));
      const select = screen.getByRole('combobox', { name: 'Default model' });
      fireEvent.change(select, { target: { value: 'reasoning' } });
      expect(select).toHaveProperty('value', 'reasoning');

      const refreshed = initial.map((model) => ({ ...model }));
      setModels(reordered ? refreshed.reverse() : refreshed);

      expect(screen.getByRole('combobox', { name: 'Default model' })).toBe(
        select
      );
      expect(select).toHaveProperty('value', 'reasoning');
      expect(value()).toBe('reasoning');
      expect(onChange).toHaveBeenCalledExactlyOnceWith('reasoning');
    }
  );
});
