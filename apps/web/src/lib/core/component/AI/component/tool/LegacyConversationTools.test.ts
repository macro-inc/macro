import {
  deserializeToolCall,
  deserializeToolResponse,
} from '@service-cognition/generated/tools/tool';
import { describe, expect, it } from 'vitest';

const id = '0195d721-1730-7cda-a72e-855bec53411e';

describe('saved legacy conversation tool records', () => {
  it('keeps old mixed listings readable', () => {
    expect(
      deserializeToolCall({
        id,
        name: 'ListEntities',
        json: { includeTypes: ['ai_chat'] },
      }).isOk()
    ).toBe(true);
    const result = deserializeToolResponse({
      id,
      name: 'ListEntities',
      json: {
        items: [
          { type: 'aiChat', id, name: 'Saved conversation' },
          {
            type: 'document',
            id,
            name: 'Notes',
            fileType: 'md',
            subType: null,
          },
        ],
        summary: '2 items',
        hasMore: false,
      },
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.data).toHaveProperty('items.length', 2);
    }
  });

  it('keeps old folder results and mutation records readable', () => {
    expect(
      deserializeToolResponse({
        id,
        name: 'ReadProject',
        json: {
          projectId: id,
          projectName: 'Folder',
          parentProjectId: null,
          items: [
            {
              id,
              itemType: 'chat',
              name: 'Saved conversation',
              fileType: null,
              updatedAt: null,
            },
          ],
        },
      }).isOk()
    ).toBe(true);
    for (const name of ['RenameItem', 'MoveToTrash', 'SetFavorite'] as const) {
      const data = {
        entityType: 'chat',
        entityId: id,
        name: 'Renamed',
        favorite: true,
      };
      expect(deserializeToolCall({ id, name, json: data }).isOk()).toBe(true);
    }
    expect(
      deserializeToolResponse({
        id,
        name: 'RenameItem',
        json: { entityType: 'chat', entityId: id, name: 'Renamed' },
      }).isOk()
    ).toBe(true);
    expect(
      deserializeToolCall({
        id,
        name: 'NameSearch',
        json: { name: 'saved', entityTypes: ['chats'] },
      }).isOk()
    ).toBe(true);
  });
});
