/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { MagicChipView } from './MagicChipView';
import type { MagicChipPresentation } from './presentation';

vi.mock('./MagicChipPullRequest', () => ({
  MagicChipPullRequest: () => <button type="button">Open PR fixture</button>,
}));
afterEach(cleanup);

it('switches exclusively between output, PR and error detail as live state changes', () => {
  const [url, setUrl] = createSignal<string>();
  const [presentation, setPresentation] = createSignal<MagicChipPresentation>({
    kind: 'answering',
    markdown: 'Checking the stack build.',
    activity: {
      label: 'Running command',
      detail: 'private command',
      tone: 'tool',
      busy: true,
    },
  });
  const view = render(() => (
    <MagicChipView
      agentSessionId="test"
      header={{ agent: 'Cursor Agent', pullRequestUrl: url() }}
      presentation={presentation()}
    />
  ));
  expect(screen.getByText('Checking the stack build.')).toBeTruthy();
  expect(screen.queryByText('private command')).toBeNull();
  setUrl('https://github.com/macro-inc/macro/pull/42');
  expect(screen.getByRole('button', { name: 'Open PR fixture' })).toBeTruthy();
  expect(screen.queryByText('Checking the stack build.')).toBeNull();
  setPresentation({
    kind: 'answering',
    markdown: 'Old output',
    activity: {
      label: "Agent couldn't answer",
      detail: 'The runtime stopped without a result.',
      tone: 'failure',
      busy: false,
    },
  });
  expect(screen.queryByRole('button', { name: 'Open PR fixture' })).toBeNull();
  expect(
    screen
      .getByText('The runtime stopped without a result.')
      .closest('[data-magic-chip-body]')
  ).toBeTruthy();
  expect(screen.queryByText('Old output')).toBeNull();
  expect(view.container.querySelector('[title]')).toBeNull();
});

it('uses a pulse dot during lazy loading and preserves session and collapse actions', () => {
  const [loading, setLoading] = createSignal(true);
  const open = vi.fn();
  const collapse = vi.fn();
  const view = render(() => (
    <MagicChipView
      agentSessionId="test"
      loading={loading()}
      presentation={{ kind: 'settled', markdown: 'Done.' }}
      onOpen={open}
      onCollapse={collapse}
    />
  ));
  const icon = view.container.querySelector(
    '[data-magic-chip-status-icon="loading"]'
  );
  expect(icon?.querySelector('svg')).toBeNull();
  expect(icon?.querySelector('.animate-pulse')).toBeTruthy();
  expect(screen.queryByText('Done.')).toBeNull();
  setLoading(false);
  fireEvent.click(screen.getByRole('button', { name: 'Open session' }));
  expect(open).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Collapse to mention' }));
  expect(collapse).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(
    screen.getByRole('button', { name: 'Open agent session' }),
    { key: 'Enter' }
  );
  expect(open).toHaveBeenCalledTimes(2);
});

it('selects document cards without navigating and preserves the explicit session action', () => {
  const select = vi.fn();
  const open = vi.fn();
  const [selected, setSelected] = createSignal(false);
  const view = render(() => (
    <MagicChipView
      agentSessionId="test"
      inDocument
      selected={selected()}
      onSelect={select}
      onOpen={open}
      presentation={{ kind: 'settled', markdown: 'Document response' }}
    />
  ));
  const card = view.container.querySelector('[data-magic-chip-card]')!;
  expect(card.classList.contains('bg-surface')).toBe(true);
  fireEvent.click(screen.getByText('Document response'));
  expect(select).toHaveBeenCalledTimes(1);
  expect(open).not.toHaveBeenCalled();
  setSelected(true);
  expect(card.classList.contains('ring-2')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Open session' }));
  expect(open).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledTimes(1);
});
