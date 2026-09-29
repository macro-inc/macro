import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal, For, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingIntegration } from '../core/onboardingIntegrations';
import { ToolsStep } from './ToolsStep';

// Layout virtualization is not part of the website's selection contract.
vi.mock('virtua/solid', () => ({
  Virtualizer: (props: {
    data: number[];
    children: (row: number) => JSX.Element;
  }) => <For each={props.data}>{props.children}</For>,
}));

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('No network in public tools preview')))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  const [selected, setSelected] = createSignal<OnboardingIntegration[]>([]);
  const onContinue = vi.fn();
  const view = render(() => (
    <ToolsStep
      preview
      connectorNames={['Linear', 'Notion', 'Slack', 'GitHub']}
      selected={selected()}
      onSelectionChange={setSelected}
      onContinue={onContinue}
    />
  ));
  return { ...view, selected, onContinue };
}

describe('standalone public integration picker', () => {
  it('searches only bundled examples and preserves choices while filtering', () => {
    const view = setup();
    expect(view.getAllByRole('button', { pressed: false })).toHaveLength(7);
    fireEvent.click(view.getByRole('button', { name: 'Select Linear' }));
    expect(view.selected().map((entry) => entry.id)).toEqual(['linear']);

    const search = view.getByRole('searchbox', {
      name: 'Search integrations and MCPs',
    });
    fireEvent.input(search, { target: { value: 'github' } });
    expect(view.queryByRole('button', { name: 'Deselect Linear' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Select GitHub' }));
    expect(view.selected().map((entry) => entry.id)).toEqual([
      'linear',
      'github',
    ]);

    fireEvent.input(search, { target: { value: '' } });
    expect(
      view
        .getByRole('button', { name: 'Deselect Linear' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    fireEvent.click(
      view.getByRole('button', { name: 'Continue with 2 integrations' })
    );
    expect(view.onContinue).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lets visitors remove every choice and continue, including after an empty search', () => {
    const view = setup();
    fireEvent.click(view.getByRole('button', { name: 'Select Notion' }));
    fireEvent.click(view.getByRole('button', { name: 'Deselect Notion' }));
    fireEvent.input(view.getByRole('searchbox'), {
      target: { value: 'unavailable tool' },
    });
    expect(
      view.getByText(
        'No integrations match “unavailable tool”. Try another name.'
      )
    ).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Continue' }));
    expect(view.onContinue).toHaveBeenCalledOnce();
    expect(view.selected()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
