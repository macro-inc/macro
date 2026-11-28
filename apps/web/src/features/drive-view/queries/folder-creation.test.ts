import { expect, it, vi } from 'vitest';
import { createFolderCommands } from './folder-creation';

const save = vi.hoisted(() => vi.fn(async () => {}));
const current = vi.hoisted(() => vi.fn(() => true));

vi.mock('@graphql-cache/session-generation', () => ({
  cacheSessionGeneration: {
    capture: () => 'viewer-at-open',
    isCurrent: current,
  },
}));
vi.mock('@queries/properties/graphql/created-entity-tags', () => ({
  saveCreatedEntityTags: save,
}));
vi.mock('@core/util/upload', () => ({ uploadFiles: vi.fn() }));
vi.mock('@queries/history/history', () => ({ refetchHistory: vi.fn() }));
vi.mock('@queries/soup/cache', () => ({ refetchSoupEntity: vi.fn() }));
vi.mock('@queries/storage/projects', () => ({ createProject: vi.fn() }));

it('adds tags to the already created folder and omits empty sets', async () => {
  const commands = createFolderCommands({ parentId: 'parent' });
  await commands.saveTags('child', { team: ['option'], personal: [] });
  expect(current).toHaveBeenCalledWith('viewer-at-open');
  expect(save).toHaveBeenCalledExactlyOnceWith({
    entityType: 'PROJECT',
    entityId: 'child',
    properties: [
      {
        propertyDefinitionId: 'team',
        addOptionIds: ['option'],
        removeOptionIds: [],
      },
    ],
  });
});
