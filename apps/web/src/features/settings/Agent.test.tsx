/**
 * @vitest-environment jsdom
 */

import {
  connectionsRest,
  setConnectionsRest,
} from '@core/signal/connectionsRest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent } from './Agent';

const mocks = vi.hoisted(() => ({
  selectTab: vi.fn(),
}));

vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({
    selectTab: mocks.selectTab,
  }),
}));

afterEach(() => {
  mocks.selectTab.mockClear();
  setConnectionsRest(null);
});

describe('Agent', () => {
  it('signposts inbound connectors to Connections Discover', () => {
    render(() => <Agent />);

    fireEvent.click(
      screen.getByRole('button', {
        name: /Looking to connect Macro to your favorite tools/,
      })
    );

    expect(mocks.selectTab).toHaveBeenCalledWith('Connected');
    expect(connectionsRest()).toBe('discover');
  });
});
