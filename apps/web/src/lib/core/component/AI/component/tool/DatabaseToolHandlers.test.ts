import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from './ToolRenderer';

const state = vi.hoisted(() => ({
  enabled: false,
  imports: 0,
  handleResponse: vi.fn(),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableDatabases: { key: 'enable-databases', override: undefined },
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

const { isToolShown, lazyDatabaseToolHandlers } = await import(
  './DatabaseToolHandlers'
);

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

describe('database tool visibility', () => {
  it('shows every tool while databases are on', () => {
    expect(isToolShown('QueryDatabase', true)).toBe(true);
    expect(isToolShown('SaveDatabaseQuery', true)).toBe(true);
    expect(isToolShown('ReadContent', true)).toBe(true);
  });

  it('hides only database tools while databases are off', () => {
    expect(isToolShown('ListDatabases', false)).toBe(false);
    expect(isToolShown('DescribeDatabase', false)).toBe(false);
    expect(isToolShown('QueryDatabase', false)).toBe(false);
    expect(isToolShown('SaveDatabaseView', false)).toBe(false);
    expect(isToolShown('SaveDatabaseQuery', false)).toBe(false);
    expect(isToolShown('ReadContent', false)).toBe(true);
    expect(isToolShown('CreateDocument', false)).toBe(true);
  });
});

describe('lazy database tool handlers', () => {
  beforeEach(() => {
    state.enabled = false;
    state.imports = 0;
    state.handleResponse.mockReset();
  });

  it('never loads the database tools for a response while databases are off', async () => {
    await lazyDatabaseToolHandlers.SaveDatabaseView.handleResponse?.(savedView);
    expect(state.imports).toBe(0);
    expect(state.handleResponse).not.toHaveBeenCalled();
  });

  it('loads the database tools and forwards a response while databases are on', async () => {
    state.enabled = true;
    await lazyDatabaseToolHandlers.SaveDatabaseView.handleResponse?.(savedView);
    expect(state.imports).toBe(1);
    expect(state.handleResponse).toHaveBeenCalledWith(savedView);
  });
});
