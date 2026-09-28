/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSettings } from './AgentSettings';

vi.mock('@solidjs/router', () => ({
  useSearchParams: () => [{}],
}));

vi.mock('./components/bring-your-own-agent', () => ({
  BringYourOwnAgent: () => <div>Bring your own agent</div>,
}));

// Each section owns a SettingsPage: the scroll container swaps with the tab.
function FakePage(props: { title: string; navigation: JSX.Element }) {
  return (
    <div data-settings-page>
      {props.navigation}
      <h1>{props.title}</h1>
    </div>
  );
}

vi.mock('./Agents', () => ({
  Agents: (props: { navigation: JSX.Element }) => (
    <FakePage title="Team agents" navigation={props.navigation} />
  ),
}));

vi.mock('./Harness', () => ({
  Harness: (props: { navigation: JSX.Element }) => (
    <FakePage title="Built-in runtimes" navigation={props.navigation} />
  ),
}));

afterEach(() => {
  cleanup();
});

describe('AgentSettings section tabs', () => {
  it('keeps the scroll offset when the section swaps its page', () => {
    render(() => <AgentSettings />);
    const page = () =>
      document.querySelector<HTMLElement>('[data-settings-page]');
    const first = page();
    if (!first) throw new Error('no settings page');
    first.scrollTop = 260;

    fireEvent.click(screen.getByRole('button', { name: 'Runtimes' }));
    expect(screen.getByText('Built-in runtimes')).toBeTruthy();
    const second = page();
    expect(second).not.toBe(first);
    expect(second?.scrollTop).toBe(260);

    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    expect(screen.getByText('Team agents')).toBeTruthy();
    expect(page()?.scrollTop).toBe(260);
  });
});
