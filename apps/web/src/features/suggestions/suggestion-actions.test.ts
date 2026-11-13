import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSuggestionActions } from './suggestion-actions';

const preview = vi.hoisted(() => ({
  item: {} as Record<string, unknown>,
}));

vi.mock('@queries/preview/preview', () => ({
  getItemPreview: async () => preview.item,
}));
vi.mock('@app/features/agents-view/primitives/open-page', () => ({
  openAgentsPage: vi.fn(),
}));
vi.mock('@app/features/calendar-view/calendar-navigation', () => ({
  openCalendarView: vi.fn(),
}));
vi.mock('@app/features/chat/ChatWithAgentButton', () => ({
  openChatWithInput: vi.fn(),
}));
vi.mock('@app/features/projects/open-project', () => ({
  projectHostedContent: vi.fn(),
}));

function host() {
  const openWithSplit = vi.fn();
  const actions = createSuggestionActions(
    { openWithSplit },
    {
      routineText: () => undefined,
      reviewRoutine: vi.fn(),
      turnOnRoutine: vi.fn(async () => {}),
    }
  );

  return { actions, openWithSplit };
}

describe('opening a suggestion’s document', () => {
  beforeEach(() => {
    preview.item = {};
  });

  it('opens the view for the document’s file type', async () => {
    preview.item = {
      id: 'document-1',
      type: 'document',
      access: 'access',
      loading: false,
      fileType: 'pdf',
    };
    const { actions, openWithSplit } = host();

    actions.openItem({ entityType: 'document', entityId: 'document-1' });

    await vi.waitFor(() =>
      expect(openWithSplit).toHaveBeenCalledWith(
        { type: 'pdf', id: 'document-1' },
        { activate: true, preferNewSplit: true }
      )
    );
  });

  it('opens a document it can’t read as a note, which says so, instead of nothing', async () => {
    preview.item = {
      id: 'document-1',
      type: 'document',
      access: 'no_access',
      loading: false,
    };
    const { actions, openWithSplit } = host();

    actions.openItem({ entityType: 'document', entityId: 'document-1' });

    await vi.waitFor(() =>
      expect(openWithSplit).toHaveBeenCalledWith(
        { type: 'md', id: 'document-1' },
        { activate: true, preferNewSplit: true }
      )
    );
  });
});
