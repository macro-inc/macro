/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionsPage } from './ConnectionsPage';

const mocks = vi.hoisted(() => ({
  selectTab: vi.fn(),
  ready: true,
  error: null as Error | null,
}));

vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({
    selectTab: mocks.selectTab,
  }),
}));

vi.mock('./use-connections-model', () => ({
  useConnectionsModel: () => ({
    model: () => ({
      capabilities: [],
      leftovers: [],
      providers: [],
    }),
    ready: () => mocks.ready,
    error: () => mocks.error,
    retry: vi.fn(),
  }),
}));

afterEach(() => {
  mocks.selectTab.mockClear();
  mocks.ready = true;
  mocks.error = null;
});

describe('ConnectionsPage', () => {
  it('signposts outbound Macro MCP to the MCP server tab', () => {
    render(() => <ConnectionsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Macro MCP' }));

    expect(mocks.selectTab).toHaveBeenCalledWith('Agent');
  });
});
