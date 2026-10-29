/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentKind } from '../agents-view/core/agent-kind';
import { AgentSettings } from './AgentSettings';

const searchParams = vi.hoisted(() => ({
  pair: undefined as string | undefined,
}));
const setSearchParams = vi.hoisted(() => vi.fn());
vi.mock('@solidjs/router', () => ({
  useSearchParams: () => [searchParams, setSearchParams],
}));

vi.mock('./Agents', () => ({
  Agents: (props: {
    createKind?: AgentKind;
    onCloseCreate?: () => void;
    onCursor: () => void;
    onNewRuntime: () => void;
    focusRuntimes?: boolean;
  }) => (
    <div>
      <h1>Agents page</h1>
      <span>{props.createKind}</span>
      <span>{props.focusRuntimes ? 'Runtimes in view' : 'Top of page'}</span>
      <button onClick={props.onCloseCreate}>Cancel create</button>
      <button type="button" onClick={props.onCursor}>
        Add Cursor
      </button>
      <button type="button" onClick={props.onNewRuntime}>
        New runtime
      </button>
    </div>
  ),
}));

vi.mock('./CursorConnectPage', () => ({
  CursorConnectPage: (props: { onClose: () => void }) => (
    <div>
      <h1>Cursor guide</h1>
      <button type="button" onClick={props.onClose}>
        Back
      </button>
    </div>
  ),
}));

vi.mock('./RuntimePairingPage', () => ({
  RuntimePairingPage: (props: {
    initialCode?: string;
    onClose: () => void;
  }) => (
    <div>
      <h1>Pairing guide</h1>
      <span>{props.initialCode}</span>
      <button type="button" onClick={props.onClose}>
        Back
      </button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  searchParams.pair = undefined;
  setSearchParams.mockClear();
});

describe('AgentSettings', () => {
  it('opens Cursor and pairing from the agents page and comes back', () => {
    render(() => <AgentSettings />);
    expect(screen.getByRole('heading', { name: 'Agents page' })).toBeTruthy();
    expect(screen.getByText('Top of page')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add Cursor' }));
    expect(screen.getByRole('heading', { name: 'Cursor guide' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Top of page')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'New runtime' }));
    expect(screen.getByRole('heading', { name: 'Pairing guide' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByRole('heading', { name: 'Agents page' })).toBeTruthy();
    expect(screen.getByText('Runtimes in view')).toBeTruthy();
  });

  it('scrolls to the runtimes for the Runtimes settings tab', () => {
    render(() => <AgentSettings initialSection="runtimes" />);
    expect(screen.getByRole('heading', { name: 'Agents page' })).toBeTruthy();
    expect(screen.getByText('Runtimes in view')).toBeTruthy();
  });

  it('opens pairing with the code from the URL', () => {
    searchParams.pair = 'KX7M-4QHD';
    render(() => <AgentSettings />);
    expect(screen.getByRole('heading', { name: 'Pairing guide' })).toBeTruthy();
    expect(screen.getByText('KX7M-4QHD')).toBeTruthy();
    expect(setSearchParams).toHaveBeenCalledWith(
      { pair: undefined },
      { replace: true }
    );
  });
});

it('leaves a setup page for a requested creation and returns to the agent list on cancel', () => {
  const [kind, setKind] = createSignal<AgentKind>();
  render(() => (
    <AgentSettings
      createKind={kind()}
      onCloseCreate={() => setKind(undefined)}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'New runtime' }));
  expect(screen.getByText('Pairing guide')).toBeTruthy();
  setKind('coder');
  expect(screen.getByText('coder')).toBeTruthy();
  expect(screen.queryByText('Pairing guide')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel create' }));
  expect(screen.getByText('Agents page')).toBeTruthy();
  setKind('agent');
  fireEvent.click(screen.getByRole('button', { name: 'New runtime' }));
  expect(screen.getByText('Pairing guide')).toBeTruthy();
  expect(kind()).toBeUndefined();
});
