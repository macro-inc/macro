/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSettings } from './AgentSettings';
import { BringYourOwnAgent } from './components/bring-your-own-agent';

const params = vi.hoisted(() => ({ pair: undefined as string | undefined }));
vi.mock('@solidjs/router', () => ({ useSearchParams: () => [params] }));

// Exercise host navigation with lightweight slots. The real forms have their
// own API, permission, pending-state and mutation integration tests.
vi.mock('./Agents', () => ({
  Agents: (props: { navigation: JSX.Element }) => (
    <div>
      {props.navigation}
      <p>Agent roster</p>
    </div>
  ),
}));
vi.mock('./Harness', () => ({
  Harness: (props: { navigation: JSX.Element }) => (
    <div>
      {props.navigation}
      <BringYourOwnAgent onAddRuntime={() => {}} />
      <p>Runtime list</p>
    </div>
  ),
}));

beforeEach(() => {
  params.pair = undefined;
});

describe('unified agent management', () => {
  it('switches between agent definitions and runtimes in the same page', () => {
    render(() => <AgentSettings />);
    expect(screen.getByText('Agent roster')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Runtimes' }));
    expect(screen.getByText('Runtime list')).toBeTruthy();
    expect(screen.queryByText('Agent roster')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    expect(screen.getByText('Agent roster')).toBeTruthy();
  });

  it('shows bring-your-own only on the Runtimes tab', () => {
    render(() => <AgentSettings />);
    expect(
      screen.queryByRole('heading', { name: 'Bring your agent to Macro' })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Runtimes' }));
    expect(
      screen.getByRole('heading', { name: 'Bring your agent to Macro' })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    expect(
      screen.queryByRole('heading', { name: 'Bring your agent to Macro' })
    ).toBeNull();
  });

  it('opens runtime settings from existing connection links', () => {
    render(() => <AgentSettings initialSection="runtimes" />);
    expect(screen.getByText('Runtime list')).toBeTruthy();
  });

  it('prioritizes a daemon pairing link even on the agents entry point', () => {
    params.pair = 'KX7M-4QHD';
    render(() => <AgentSettings />);
    expect(screen.getByText('Runtime list')).toBeTruthy();
  });
});
