import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from './ToolRenderer';

const state = vi.hoisted(() => ({
  enabled: false,
  imports: 0,
  handleResponse: vi.fn(),
}));
vi.mock('@core/constant/featureFlags', () => ({
  isFeatureEnabled: () => state.enabled,
}));
vi.mock('./DatabaseTools', () => {
  state.imports++;
  return {
    databaseToolHandlers: {
      SaveDatabaseView: {
        render: () => null,
        handleResponse: state.handleResponse,
      },
    },
  };
});

const { lazyDatabaseToolHandlers } = await import('./DatabaseToolHandlers');

const savedView = {
  chat_id: 'chat',
  message_id: 'message',
  part_index: 0,
  isComplete: true,
  tool: {
    name: 'SaveDatabaseView',
    data: { view: { databaseId: 'database' } },
  },
} as unknown as ToolContext<NamedTool<'SaveDatabaseView', 'response'>>;

describe('lazy database tool handlers', () => {
  beforeEach(() => {
    state.enabled = false;
    state.imports = 0;
    state.handleResponse.mockReset();
  });

  it('loads the database tools and forwards a response while databases are on', async () => {
    state.enabled = true;
    await lazyDatabaseToolHandlers.SaveDatabaseView.handleResponse?.(savedView);
    expect(state.imports).toBe(1);
    expect(state.handleResponse).toHaveBeenCalledWith(savedView);
  });
});
