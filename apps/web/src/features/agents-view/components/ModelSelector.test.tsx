import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { Dropdown } from '@ui';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelSelector, SessionModelSelector } from './ModelSelector';

const options = [
  { id: 'gpt-5', name: 'GPT-5', description: null, group: null },
  { id: 'claude-sonnet-4', name: 'Sonnet 4', description: null, group: null },
];

describe('shared model selector', () => {
  let motionStyles: HTMLStyleElement;
  beforeEach(() => {
    // jsdom omits the CSS motion defaults required by Kobalte's presence tracking.
    motionStyles = document.createElement('style');
    motionStyles.textContent =
      '[role="menu"] { animation-name: none; transition-duration: 0s; }';
    document.head.append(motionStyles);
    vi.stubGlobal('scrollTo', vi.fn());
  });
  afterEach(() => {
    cleanup();
    motionStyles.remove();
    vi.unstubAllGlobals();
  });
  it('uses the shared pill and menu while switching a session model', async () => {
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
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /Sonnet 4/ }), {
      key: 'Enter',
    });
    expect(select).toHaveBeenCalledWith('claude-sonnet-4');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
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
        options={options.map(({ id, name }) => ({ id, name }))}
        onSelect={vi.fn()}
      >
        <Dropdown.Group>
          <Dropdown.Item>Agent default</Dropdown.Item>
        </Dropdown.Group>
      </ModelSelector>
    ));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Model' }), {
      key: 'Enter',
    });
    expect(
      screen.getByRole('menuitem', { name: 'Agent default' })
    ).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /GPT-5/ })).toBeTruthy();
  });
  it('uses pretty session names while retaining model ids for selection', async () => {
    const select = vi.fn();
    const [changingTo, setChangingTo] = createSignal<string>();
    const ids = [
      'anthropic/claude-sonnet-5',
      'anthropic/claude-opus-5',
      'anthropic/claude-haiku-4-5',
    ];
    render(() => (
      <SessionModelSelector
        model={ids[0]}
        options={ids.map((id) => ({
          id,
          name: id,
          description: null,
          group: null,
        }))}
        changingTo={changingTo()}
        onSelect={select}
      />
    ));
    const trigger = screen.getByRole('button', { name: 'Model' });
    expect(trigger.textContent).toBe('Sonnet 5');
    expect(trigger.title).toBe('Sonnet 5');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByRole('menuitem', { name: /^Haiku 4.5/ })).toBeTruthy();
    expect(screen.queryByText(ids[0])).toBeNull();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /^Opus 5/ }), {
      key: 'Enter',
    });
    expect(select).toHaveBeenCalledWith(ids[1]);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    setChangingTo(ids[1]);
    expect(trigger.textContent).toBe('Opus 5');
  });
  it('keeps the new-session default selectable before models are available', async () => {
    const selectDefault = vi.fn();
    render(() => (
      <ModelSelector
        label="Agent default"
        options={[]}
        emptyMessage="Start a session to choose models."
        onSelect={vi.fn()}
      >
        <Dropdown.Group>
          <Dropdown.Item closeOnSelect onSelect={selectDefault}>
            Agent default
          </Dropdown.Item>
        </Dropdown.Group>
      </ModelSelector>
    ));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Model' }), {
      key: 'Enter',
    });
    expect(screen.getByRole('status').textContent).toBe(
      'Start a session to choose models.'
    );
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Agent default' }), {
      key: 'Enter',
    });
    expect(selectDefault).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('shortlists a large catalog and searches every model with provider icons', async () => {
    const select = vi.fn();
    render(() => (
      <ModelSelector
        model="gpt-5-0"
        label="GPT-5 variant 0"
        options={Array.from({ length: 60 }, (_, index) => ({
          id: `gpt-5-${index}`,
          name: `GPT-5 variant ${index}`,
          group: 'GPT',
        }))}
        onSelect={select}
      />
    ));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Model' }), {
      key: 'Enter',
    });
    expect(screen.getAllByRole('menuitem').length).toBeLessThanOrEqual(6);
    expect(screen.getByRole('menuitem', { name: /More models/ })).toBeTruthy();
    fireEvent.input(screen.getByRole('textbox', { name: 'Search models' }), {
      target: { value: 'variant 59' },
    });
    const model = screen.getByRole('menuitem', { name: /GPT-5 variant 59/ });
    expect(model.querySelector('[data-ai-provider="openai"] svg')).toBeTruthy();
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    fireEvent.keyDown(model, { key: 'Enter' });
    expect(select).toHaveBeenCalledWith('gpt-5-59');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('keeps the session selector visible while its catalog arrives', async () => {
    const [catalog, setCatalog] = createSignal<typeof options>([]);
    const select = vi.fn();
    render(() => (
      <SessionModelSelector
        model="gpt-5"
        options={catalog()}
        onSelect={select}
      />
    ));
    const trigger = screen.getByRole('button', { name: 'Model' });
    expect(trigger.textContent).toContain('gpt-5');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByRole('status').textContent).toContain(
      'Waiting for the agent'
    );
    setCatalog(options);
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /Sonnet 4/ }), {
      key: 'Enter',
    });
    expect(select).toHaveBeenCalledWith('claude-sonnet-4');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});
