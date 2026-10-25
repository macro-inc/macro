/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { Dropdown } from '@ui';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type ModelEffortConfig, ModelEffortMenu } from './ModelEffortMenu';

const config: ModelEffortConfig = {
  id: 'runtime-effort',
  name: 'Power',
  category: 'thought_level',
  type: 'select',
  description: null,
  currentValue: 'low',
  options: [
    { name: 'Low', value: 'low', group: null, description: null },
    { name: 'High', value: 'high', group: null, description: null },
    { name: 'Max', value: 'max', group: null, description: null },
  ],
};
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(disabled = false, effortConfig = config) {
  const change = vi.fn();
  const [value, setValue] = createSignal(effortConfig.currentValue);
  render(() => (
    <>
      <style>
        {'[role="menu"] { animation-name: none; transition-duration: 0s; }'}
      </style>
      <Dropdown>
        <Dropdown.Trigger>Model settings</Dropdown.Trigger>
        <Dropdown.Content>
          <ModelEffortMenu
            model="gpt-5"
            label="GPT-5"
            config={effortConfig}
            value={value()}
            disabled={disabled}
            onChange={(next) => {
              change(next);
              setValue(next);
            }}
          >
            <Dropdown.Item onSelect={() => change('other-model')}>
              Other model
            </Dropdown.Item>
          </ModelEffortMenu>
        </Dropdown.Content>
      </Dropdown>
    </>
  ));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Model settings' }), {
    key: 'Enter',
  });
  return change;
}

it('adjusts named effort stops with the keyboard without dismissing the menu', async () => {
  const change = setup();
  const slider = await screen.findByRole('slider', {
    name: 'Reasoning effort',
  });
  slider.focus();
  expect(slider.getAttribute('aria-valuetext')).toBe('Low');
  fireEvent.keyDown(slider, { key: 'ArrowRight' });
  expect(change).toHaveBeenLastCalledWith('high');
  expect(slider.getAttribute('aria-valuetext')).toBe('High');
  expect(screen.getByRole('menu')).toBeTruthy();
  fireEvent.keyDown(slider, { key: 'ArrowRight' });
  expect(change).toHaveBeenLastCalledWith('max');
  fireEvent.keyDown(slider, { key: 'ArrowRight' });
  expect(change).toHaveBeenLastCalledWith('max');
  fireEvent.keyDown(slider, { key: 'ArrowLeft' });
  fireEvent.keyDown(slider, { key: 'ArrowLeft' });
  expect(change).toHaveBeenLastCalledWith('low');
});

it('tracks a captured thumb drag immediately and commits only on release', () => {
  const change = setup();
  const slider = screen.getByRole('slider', { name: 'Reasoning effort' });
  const track = slider.parentElement!;
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 200, 24)
  );
  let captured = false;
  slider.setPointerCapture = () => {
    captured = true;
  };
  slider.hasPointerCapture = () => captured;
  slider.releasePointerCapture = () => {
    captured = false;
  };
  fireEvent(
    slider,
    Object.assign(
      new MouseEvent('pointerdown', { bubbles: true, clientX: 0 }),
      {
        pointerId: 1,
        pointerType: 'mouse',
      }
    )
  );
  fireEvent(
    slider,
    Object.assign(
      new MouseEvent('pointermove', { bubbles: true, clientX: 100 }),
      {
        pointerId: 1,
        pointerType: 'mouse',
      }
    )
  );
  expect(slider.getAttribute('aria-valuetext')).toBe('High');
  expect(slider.closest('[data-scrubbing]')).not.toBeNull();
  expect(change).not.toHaveBeenCalled();
  fireEvent(
    slider,
    Object.assign(
      new MouseEvent('pointerup', { bubbles: true, clientX: 100 }),
      {
        pointerId: 1,
        pointerType: 'mouse',
      }
    )
  );
  expect(change).toHaveBeenCalledExactlyOnceWith('high');
  expect(slider.closest('[data-scrubbing]')).toBeNull();
  expect(screen.getByRole('menu')).toBeTruthy();
});

it('opens the catalog, returns to effort, and dismisses with Escape', async () => {
  setup();
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Choose model' }), {
    key: 'Enter',
  });
  expect(screen.getByRole('menuitem', { name: 'Other model' })).toBeTruthy();
  expect(screen.queryByRole('slider', { name: 'Reasoning effort' })).toBeNull();
  fireEvent.keyDown(
    screen.getByRole('menuitem', { name: 'Model and effort' }),
    { key: 'Enter' }
  );
  const slider = screen.getByRole('slider', { name: 'Reasoning effort' });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('menuitem', { name: 'Choose model' })
    )
  );
  fireEvent.keyDown(slider, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});

it('does not change a disabled effort control', () => {
  const change = setup(true);
  fireEvent.keyDown(screen.getByRole('slider', { name: 'Reasoning effort' }), {
    key: 'ArrowRight',
  });
  expect(change).not.toHaveBeenCalled();
});

it('preserves the inherited default until a specific effort is selected', () => {
  const change = setup(false, {
    ...config,
    id: 'reasoning_effort',
    currentValue: 'default',
    options: [
      { name: 'Default', value: 'default', group: null, description: null },
      config.options[0],
      { name: 'Medium', value: 'medium', group: null, description: null },
      config.options[1],
    ],
  });
  const slider = screen.getByRole('slider', { name: 'Reasoning effort' });
  expect(slider.getAttribute('aria-valuetext')).toBe('Default');
  slider.focus();
  fireEvent.keyDown(slider, { key: 'ArrowRight' });
  expect(change).toHaveBeenLastCalledWith('low');
  expect(slider.getAttribute('aria-valuetext')).toBe('Low');
  fireEvent.keyDown(slider, { key: 'ArrowRight' });
  expect(change).toHaveBeenLastCalledWith('medium');
});

it('shows the catalog directly for a model with no effort configuration', () => {
  render(() => (
    <Dropdown>
      <Dropdown.Trigger>Model settings</Dropdown.Trigger>
      <Dropdown.Content>
        <ModelEffortMenu label="Basic model">
          <Dropdown.Item>Basic model</Dropdown.Item>
        </ModelEffortMenu>
      </Dropdown.Content>
    </Dropdown>
  ));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Model settings' }), {
    key: 'Enter',
  });
  expect(screen.getByRole('menuitem', { name: 'Basic model' })).toBeTruthy();
  expect(screen.queryByRole('slider')).toBeNull();
});
