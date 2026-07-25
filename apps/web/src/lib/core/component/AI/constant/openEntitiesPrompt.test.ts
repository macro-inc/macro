import { beforeEach, describe, expect, test, vi } from 'vitest';

const { splitManager } = vi.hoisted(() => ({
  splitManager: {
    splits: vi.fn(),
    getSplit: vi.fn(),
  },
}));

vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => splitManager,
}));

import { getOpenEntitiesPrompt } from './openEntitiesPrompt';

describe('getOpenEntitiesPrompt', () => {
  beforeEach(() => {
    splitManager.splits.mockReset();
    splitManager.getSplit.mockReset();
  });

  test('excludes the current chat while preserving other open entities', () => {
    splitManager.splits.mockReturnValue([
      { id: 'split-current', content: { type: 'chat', id: 'current-chat' } },
      { id: 'split-other', content: { type: 'chat', id: 'other-chat' } },
      { id: 'split-document', content: { type: 'md', id: 'document-id' } },
    ]);
    splitManager.getSplit.mockImplementation((splitId: string) => ({
      displayName: () =>
        splitId === 'split-other' ? 'Another chat' : 'Project notes',
    }));

    expect(getOpenEntitiesPrompt('current-chat')).toBe(
      '\nThe user currently has the following items open:\n' +
        '- Another chat (chat, id: other-chat)\n' +
        '- Project notes (md, id: document-id)'
    );
    expect(splitManager.getSplit).not.toHaveBeenCalledWith('split-current');
  });

  test('returns no open-entity prompt when only the current chat is open', () => {
    splitManager.splits.mockReturnValue([
      { id: 'split-current', content: { type: 'chat', id: 'current-chat' } },
    ]);

    expect(getOpenEntitiesPrompt('current-chat')).toBeNull();
  });
});
