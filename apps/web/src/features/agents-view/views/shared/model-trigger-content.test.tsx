import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createStore } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import {
  UnifiedModelSelectorRoot,
  type UnifiedModelSelectorState,
} from '../../components/unified-model-selector/root';
import { DesktopModelSelector } from '../model-selector/desktop-model-selector';

afterEach(cleanup);

it('keeps the model default separate from confirmed Thinking changes', async () => {
  const [state, setState] = createStore<UnifiedModelSelectorState>({
    model: 'gpt-6.1-sol',
    models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' }],
    suggestedModels: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' }],
    effort: {
      id: 'opaque-effort',
      name: 'Thinking',
      category: 'thought_level',
      description: null,
      type: 'select',
      currentValue: 'a',
      options: [
        { value: 'a', name: 'Low', description: null, group: null },
        { value: 'b', name: 'High', description: null, group: null },
      ],
    },
    defaultEffortValue: 'a',
    onModel: vi.fn(),
    onSpeed: vi.fn(),
    onEffort: (choice) => setState('effort', 'currentValue', choice.value),
  });
  render(() => (
    <UnifiedModelSelectorRoot state={state}>
      <DesktopModelSelector />
    </UnifiedModelSelectorRoot>
  ));
  const trigger = screen.getByRole('button', {
    name: 'Choose an agent or model',
  });
  expect(trigger.textContent).not.toContain('Low');
  fireEvent.click(trigger);
  const slider = await screen.findByRole('slider', { name: 'Thinking' });
  slider.focus();
  fireEvent.keyDown(slider, { key: 'End' });
  expect(trigger.textContent).toContain('High');
  expect(state.effort?.currentValue).toBe('b');

  // Unknown defaults do not label an unverified value as a customization.
  setState('defaultEffortValue', undefined);
  expect(trigger.textContent).not.toContain('High');
  setState('defaultEffortValue', 'a');
  expect(trigger.textContent).toContain('High');
  fireEvent.keyDown(slider, { key: 'Home' });
  expect(trigger.textContent).not.toContain('Low');
  expect(trigger.textContent).not.toContain('High');
});
