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
].map((id) => ({ id, name: id, description: null, group: null }));

let motionStyles: HTMLStyleElement;
beforeEach(() => {
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
