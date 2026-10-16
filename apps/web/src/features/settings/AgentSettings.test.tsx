/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSettings } from './AgentSettings';

const searchParams = vi.hoisted(() => ({
  pair: undefined as string | undefined,
}));
vi.mock('@solidjs/router', () => ({
  useSearchParams: () => [searchParams],
}));

vi.mock('./Agents', () => ({
  Agents: (props: {
    onCursor: () => void;
    onSetUpRuntime: () => void;
    onManageRuntimes: () => void;
  }) => (
    <div>
      <h1>Agents page</h1>
      <button type="button" onClick={props.onCursor}>
        Connect Cursor
      </button>
      <button type="button" onClick={props.onSetUpRuntime}>
        Set up your own agent
      </button>
      <button type="button" onClick={props.onManageRuntimes}>
        Manage paired runtimes
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
  RuntimePairingPage: (props: { onClose: () => void }) => (
    <div>
      <h1>Pairing guide</h1>
      <button type="button" onClick={props.onClose}>
        Back
      </button>
    </div>
  ),
}));

vi.mock('./Harness', () => ({
  Harness: (props: { onBack?: () => void }) => (
    <div>
      <h1>Runtimes page</h1>
      <button type="button" onClick={props.onBack}>
        Back
      </button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  searchParams.pair = undefined;
});

describe('AgentSettings', () => {
  it('opens each setup page from the agents page and comes back', () => {
    render(() => <AgentSettings />);
    expect(screen.getByRole('heading', { name: 'Agents page' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Connect Cursor' }));
    expect(screen.getByRole('heading', { name: 'Cursor guide' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    fireEvent.click(
      screen.getByRole('button', { name: 'Set up your own agent' })
    );
    expect(screen.getByRole('heading', { name: 'Pairing guide' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    fireEvent.click(
      screen.getByRole('button', { name: 'Manage paired runtimes' })
    );
    expect(screen.getByRole('heading', { name: 'Runtimes page' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByRole('heading', { name: 'Agents page' })).toBeTruthy();
  });

  it('starts on the runtimes page for the Runtimes settings tab', () => {
    render(() => <AgentSettings initialSection="runtimes" />);
    expect(screen.getByRole('heading', { name: 'Runtimes page' })).toBeTruthy();
  });

  it('starts on the runtimes page when a pairing code is in the URL', () => {
    searchParams.pair = 'KX7M-4QHD';
    render(() => <AgentSettings />);
    expect(screen.getByRole('heading', { name: 'Runtimes page' })).toBeTruthy();
  });
});
