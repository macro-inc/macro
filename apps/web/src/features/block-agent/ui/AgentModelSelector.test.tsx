import type { ModelOption } from '@service-agent-fold/generated/types';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentModelSelector } from './AgentModelSelector';

const device = vi.hoisted(() => ({ touch: false }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));

/**
 * The in-memory Macro Agent keeps no display names, so every option comes
 * back named after its own slug.
 */
const INMEM_MODELS: ModelOption[] = [
  'anthropic/claude-sonnet-5',
  'anthropic/claude-haiku-4-5',
  'openai/gpt-5.5',
  'fireworks/kimi-k3',
].map((id) => ({ id, name: id, description: null, group: null }));

let motionStyles: HTMLStyleElement;
const originalScrollTo = HTMLElement.prototype.scrollTo;
beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
  // jsdom omits the motion defaults Kobalte and Corvu track presence with.
  motionStyles = document.createElement('style');
  motionStyles.textContent =
    '[role="menu"], [data-corvu-drawer-content], [data-corvu-drawer-overlay] { animation-name: none; transition-duration: 0s; }';
  document.head.append(motionStyles);
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
  HTMLElement.prototype.scrollTo = originalScrollTo;
  motionStyles.remove();
  device.touch = false;
  vi.unstubAllGlobals();
});

const providerOf = (element: Element | null) =>
  element
    ?.querySelector('[data-ai-provider]')
    ?.getAttribute('data-ai-provider');

describe('agent model selector', () => {
  it('names and badges a slug-named catalog on desktop', () => {
    const select = vi.fn();
    render(() => (
      <AgentModelSelector
        model="anthropic/claude-sonnet-5"
        options={INMEM_MODELS}
        onSelect={select}
      />
    ));
    const trigger = screen.getByRole('button');
    expect(trigger.textContent).toContain('Sonnet 5');
    expect(trigger.textContent).not.toContain('claude-sonnet-5');
    expect(providerOf(trigger)).toBe('anthropic');

    fireEvent.keyDown(trigger, { key: 'Enter' });
    const haiku = screen.getByRole('menuitem', { name: /^Haiku 4.5/ });
    expect(providerOf(haiku)).toBe('anthropic');
    expect(providerOf(screen.getByRole('menuitem', { name: /^GPT-5.5/ }))).toBe(
      'openai'
    );
    expect(providerOf(screen.getByRole('menuitem', { name: /^Kimi K3/ }))).toBe(
      'kimi'
    );
    expect(screen.queryByText('anthropic/claude-haiku-4-5')).toBeNull();

    fireEvent.keyDown(haiku, { key: 'Enter' });
    expect(select).toHaveBeenCalledWith('anthropic/claude-haiku-4-5');
  });

  it('names and badges the same catalog in the touch sheet', async () => {
    device.touch = true;
    const select = vi.fn();
    render(() => (
      <AgentModelSelector
        model="anthropic/claude-sonnet-5"
        options={INMEM_MODELS}
        onSelect={select}
      />
    ));
    const trigger = screen.getByRole('button', { name: /Agent model/ });
    expect(trigger.textContent).toContain('Sonnet 5');
    expect(providerOf(trigger)).toBe('anthropic');

    fireEvent.click(trigger);
    const haiku = screen.getByRole('radio', { name: /Haiku 4.5/ });
    expect(providerOf(haiku)).toBe('anthropic');
    expect(screen.queryByText('anthropic/claude-haiku-4-5')).toBeNull();

    fireEvent.click(haiku);
    expect(select).toHaveBeenCalledWith('anthropic/claude-haiku-4-5');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps a harness display name when the harness has one', () => {
    render(() => (
      <AgentModelSelector
        model="opus-5-high"
        options={[
          {
            id: 'opus-5-high',
            name: 'Claude Opus 5 High',
            description: null,
            group: null,
          },
        ]}
        onSelect={vi.fn()}
      />
    ));
    expect(screen.getByRole('button').textContent).toContain('Opus 5 High');
  });
});

it('uses the searchable touch sheet with custom desktop model rows', async () => {
  device.touch = true;
  const select = vi.fn();
  render(() => (
    <AgentModelSelector
      model="anthropic/claude-opus-5-5"
      options={[
        {
          id: 'anthropic/claude-opus-5-5',
          name: 'Opus 5.5',
          description: null,
          group: null,
        },
        {
          id: 'anthropic/claude-haiku-4-5',
          name: 'Haiku 4.5',
          description: null,
          group: null,
        },
      ]}
      modelRow={() => <div>Desktop custom row</div>}
      onSelect={select}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Agent model' }));
  const search = await screen.findByRole('textbox', { name: 'Search models' });
  await waitFor(() => expect(document.activeElement).toBe(search));
  expect(screen.getByRole('radiogroup', { name: 'Suggested' })).toBeTruthy();
  expect(screen.queryByText('Desktop custom row')).toBeNull();
  expect(screen.queryByRole('radio', { name: 'Haiku 4.5' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'More models' }));
  expect(screen.getByRole('radio', { name: 'Opus 5.5' })).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'Haiku 4.5' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Back to Suggested' }));
  fireEvent.input(search, { target: { value: 'haiku' } });
  fireEvent.click(screen.getByRole('radio', { name: 'Haiku 4.5' }));
  expect(select).toHaveBeenCalledExactlyOnceWith('anthropic/claude-haiku-4-5');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('keeps the touch picker visible while models load', async () => {
  device.touch = true;
  render(() => (
    <AgentModelSelector
      model="openai/gpt-5.6"
      options={[]}
      onSelect={vi.fn()}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Agent model' }));
  const status = await screen.findByRole('status');
  expect(status.textContent).toContain('Waiting for the agent');
  expect(screen.getByRole('textbox', { name: 'Search models' })).toBeTruthy();
});

it('preserves the current effort label in the mobile model trigger', () => {
  device.touch = true;
  render(() => (
    <AgentModelSelector
      model="gpt-5"
      options={[{ id: 'gpt-5', name: 'GPT-5', group: null, description: null }]}
      effortLabel="High"
      onSelect={vi.fn()}
    />
  ));
  expect(
    screen.getByRole('button', { name: 'Agent model' }).textContent
  ).toContain('GPT-5 · High');
  expect(screen.queryByRole('slider')).toBeNull();
});
