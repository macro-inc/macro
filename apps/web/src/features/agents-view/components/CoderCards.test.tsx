/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, within } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { type CoderCard, CoderCards } from './CoderCards';

const NOW = Date.now();

const CODERS: CoderCard[] = [
  {
    id: 'macro-coder',
    name: 'Macro Coder',
    handle: 'coder',
    system: true,
    runtime: { label: 'Macro sandbox', connected: true },
    lastUsedAt: NOW - 2 * 60 * 60 * 1000,
    sessions: 3,
    configurable: false,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    handle: 'cursor',
    cursor: true,
    system: true,
    runtime: { label: 'Cursor', connected: false },
    lastUsedAt: 0,
    sessions: 0,
    unavailableReason: 'Connect Cursor to start it',
    connectLabel: 'Connect Cursor',
    configurable: false,
  },
  {
    id: 'reviewer',
    name: 'PR Reviewer',
    handle: 'reviewer',
    system: false,
    runtime: { label: 'wolf-laptop', connected: false },
    model: 'claude-opus-5',
    lastUsedAt: NOW - 26 * 60 * 60 * 1000,
    sessions: 12,
    unavailableReason: 'Its runtime is disconnected',
    configurable: true,
  },
];

describe('CoderCards', () => {
  it('renders each coder with its runtime, usage, and selection', () => {
    const onSelect = vi.fn();
    render(() => (
      <CoderCards
        coders={CODERS}
        selectedId="macro-coder"
        loading={false}
        onSelect={onSelect}
        onConnect={vi.fn()}
        onConfigure={vi.fn()}
        onCreate={vi.fn()}
      />
    ));

    const group = screen.getByRole('radiogroup', { name: 'Coder' });
    const macro = within(group).getByRole('radio', { name: /Macro Coder/ });
    expect(macro).toHaveProperty('ariaChecked', 'true');
    expect(within(macro).getByText('system')).toBeTruthy();
    expect(within(macro).getByText('2 h ago')).toBeTruthy();
    expect(within(macro).getByText(/3 sessions/)).toBeTruthy();

    const reviewer = within(group).getByRole('radio', { name: /PR Reviewer/ });
    expect(within(reviewer).getByText('claude-opus-5')).toBeTruthy();
    expect(
      within(reviewer).getByText('Its runtime is disconnected')
    ).toBeTruthy();
    fireEvent.click(reviewer);
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(macro);
    expect(onSelect).toHaveBeenCalledWith('macro-coder');
  });

  it('turns an unconnected Cursor into a connect action and exposes configure', () => {
    const onConnect = vi.fn();
    const onConfigure = vi.fn();
    const onCreate = vi.fn();
    render(() => (
      <CoderCards
        coders={CODERS}
        selectedId={undefined}
        loading={false}
        onSelect={vi.fn()}
        onConnect={onConnect}
        onConfigure={onConfigure}
        onCreate={onCreate}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Connect Cursor' }));
    expect(onConnect).toHaveBeenCalledWith('cursor');

    fireEvent.click(
      screen.getByRole('button', { name: 'Configure PR Reviewer' })
    );
    expect(onConfigure).toHaveBeenCalledWith('reviewer');
    expect(
      screen.queryByRole('button', { name: 'Configure Macro Coder' })
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Create coder' }));
    expect(onCreate).toHaveBeenCalledOnce();
  });
});
