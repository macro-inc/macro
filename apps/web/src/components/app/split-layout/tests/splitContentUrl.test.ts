import { describe, expect, it, vi } from 'vitest';
import { splitContentUrl } from '../layoutUtils';

vi.mock('../componentRegistry', () => ({
  resolveComponent: vi.fn(),
}));

vi.mock('@core/constant/allBlocks', () => ({
  isBlockAlias: vi.fn(() => false),
  resolveBlockAlias: vi.fn((type: string) => type),
}));

vi.mock('@core/util/webOrigin', () => ({
  getWebOrigin: () => 'https://macro.com',
}));

vi.mock('@core/signal/settingsTab', () => ({
  activeTabId: () => 'account',
}));

vi.mock('@core/constant/settingsTabsConfig', () => ({
  settingsTabToSlug: (tab: string) => tab,
}));

describe('splitContentUrl', () => {
  it('addresses a list view by its component id', () => {
    expect(splitContentUrl({ type: 'component', id: 'tasks' })).toBe(
      'https://macro.com/app/component/tasks'
    );
  });

  it('addresses a block by type and id', () => {
    expect(splitContentUrl({ type: 'channel', id: 'channel-123' })).toBe(
      'https://macro.com/app/channel/channel-123'
    );
  });

  it('uses the alias type when the content carries one', () => {
    expect(
      splitContentUrl({
        type: 'task',
        id: 'doc-1',
        aliasContext: { alias: 'task', baseType: 'md' },
      })
    ).toBe('https://macro.com/app/task/doc-1');
  });

  it('serializes settings with its active tab, as the URL sync does', () => {
    expect(splitContentUrl({ type: 'component', id: 'settings' })).toBe(
      'https://macro.com/app/settings/account'
    );
  });
});
