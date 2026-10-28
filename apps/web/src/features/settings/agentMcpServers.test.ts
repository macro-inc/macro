import { describe, expect, it } from 'vitest';
import {
  addMcpServer,
  catalogEntryToMcpServer,
  mcpServerConnectionState,
  removeMcpServer,
} from './agentMcpServers';

const linear = { app_slug: 'linear', server_name: 'Linear' };
const notion = { app_slug: 'notion', server_name: 'Notion' };

describe('agentMcpServers', () => {
  it('reduces a catalog entry to the stored shape', () => {
    expect(
      catalogEntryToMcpServer({
        app_slug: 'linear',
        display_name: 'Linear',
      })
    ).toEqual(linear);
  });

  it('adds by slug without duplicating', () => {
    expect(addMcpServer([], linear)).toEqual([linear]);
    expect(addMcpServer([linear], notion)).toEqual([linear, notion]);
    expect(
      addMcpServer([linear], { app_slug: 'linear', server_name: 'Other' })
    ).toEqual([linear]);
  });

  it('removes by slug', () => {
    expect(removeMcpServer([linear, notion], 'linear')).toEqual([notion]);
    expect(removeMcpServer([linear], 'missing')).toEqual([linear]);
  });

  it('reads connection state from the viewer set', () => {
    const connected = new Set(['linear']);
    expect(mcpServerConnectionState(linear, connected)).toBe('connected');
    expect(mcpServerConnectionState(notion, connected)).toBe('disconnected');
  });
});
