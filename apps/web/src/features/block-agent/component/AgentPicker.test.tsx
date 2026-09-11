import { fireEvent, render, screen, within } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AgentPicker } from './AgentPicker';
import type { PersonaOption } from './compose-agent-session-options';

vi.mock('@ui', () => {
  const Container = (props: { children?: JSX.Element }) => props.children;
  return {
    Avatar: Object.assign(Container, {
      Fallback: Container,
      Image: () => null,
    }),
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  };
});

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

const personas: PersonaOption[] = Array.from({ length: 8 }, (_, index) => ({
  id: `agent-${index}`,
  name: `Agent ${index}`,
  handle: `helper-${index}`,
  harness: 'in-memory',
  defaultModel: 'test-model',
  description: index === 7 ? 'Reviews pull requests' : undefined,
  unavailableReason: index === 1 ? 'Connect this agent first' : undefined,
}));

function mount(
  recentIds: string[] = [],
  selectedId = 'agent-0',
  disabled = false,
  onConnect?: (id: string) => void
) {
  const onSelect = vi.fn();
  render(() => {
    const [selected, setSelected] = createSignal(selectedId);
    return (
      <AgentPicker
        personas={personas.map((persona) => ({
          ...persona,
          connectLabel:
            onConnect && persona.id === 'agent-1' ? 'Connect agent' : undefined,
        }))}
        recentIds={recentIds}
        selected={personas.find((persona) => persona.id === selected())}
        disabled={disabled}
        loading={false}
        error={false}
        onConnect={onConnect ?? vi.fn()}
        onSelect={(id) => {
          setSelected(id);
          onSelect(id);
        }}
      />
    );
  });
  return onSelect;
}

const rows = () => screen.getAllByRole('radio');

describe('agent picker', () => {
  it('focuses setup actions with arrow keys without selecting or activating them', () => {
    const onConnect = vi.fn();
    const onSelect = mount([], 'agent-0', false, onConnect);
    const first = screen.getByRole('radio', { name: /Agent 0/ });
    const connect = screen.getByRole('button', { name: 'Connect agent' });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(connect);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onConnect).not.toHaveBeenCalled();
    fireEvent.click(connect);
    expect(onConnect).toHaveBeenCalledWith('agent-1');
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(connect, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledWith('agent-2');
  });
  it('keeps every agent in the horizontal strip, with recent choices first', () => {
    const recent = ['agent-7', 'agent-5', 'agent-3', 'agent-2', 'agent-0'];
    mount(recent);
    expect(
      screen.getByRole('radiogroup').getAttribute('aria-orientation')
    ).toBe('horizontal');
    expect(rows().map((row) => row.dataset.personaId)).toEqual([
      ...recent,
      'agent-1',
      'agent-4',
      'agent-6',
    ]);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Browse all/ })).toBeNull();
    for (const row of rows()) {
      expect(within(row).getByText(/@helper-/)).toBeTruthy();
      expect(within(row).queryByText(/default/)).toBeNull();
      expect(within(row).queryByText('coding')).toBeNull();
    }
  });

  it('supports keyboard selection across the full list and skips unavailable agents', () => {
    const onSelect = mount();
    rows()[0].focus();
    fireEvent.keyDown(rows()[0], { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith('agent-2');
    expect(document.activeElement).toBe(rows()[2]);
    expect(rows()[2].scrollIntoView).toHaveBeenLastCalledWith({
      block: 'nearest',
      inline: 'nearest',
    });
    fireEvent.keyDown(rows()[2], { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenLastCalledWith('agent-0');
    expect(document.activeElement).toBe(rows()[0]);
    fireEvent.keyDown(rows()[0], { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenLastCalledWith('agent-7');
    fireEvent.keyDown(rows()[7], { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith('agent-0');
    fireEvent.keyDown(rows()[0], { key: 'End' });
    expect(onSelect).toHaveBeenLastCalledWith('agent-7');
    expect(document.activeElement).toBe(rows()[7]);
    fireEvent.keyDown(rows()[7], { key: 'Home' });
    expect(onSelect).toHaveBeenLastCalledWith('agent-0');
    fireEvent.click(rows()[1]);
    expect(onSelect).toHaveBeenLastCalledWith('agent-0');
  });

  it('does not change the agent during session creation', () => {
    const onSelect = mount([], 'agent-0', true);
    fireEvent.click(rows()[2]);
    fireEvent.keyDown(rows()[0], { key: 'ArrowRight' });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
