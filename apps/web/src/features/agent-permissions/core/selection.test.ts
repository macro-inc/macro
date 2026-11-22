import { describe, expect, it } from 'vitest';
import { CATALOG } from '../tests/fixtures';
import { selectionBlocks } from './selection';

describe('selectionBlocks', () => {
  it('shows every action a group has tools for when it named none', () => {
    const [block] = selectionBlocks(CATALOG, {
      groups: [{ group: 'documents' }],
      tools: [],
    });
    expect(block.group.id).toBe('documents');
    expect(block.actions).toEqual(['destroy']);
    expect(block.tools).toEqual([]);
  });

  it('leaves out actions with no tools and groups left with nothing', () => {
    const blocks = selectionBlocks(CATALOG, {
      groups: [
        { group: 'email', actions: ['create', 'send'] },
        { group: 'documents', actions: ['send'] },
        { group: 'tasks' },
      ],
      tools: [],
    });
    expect(blocks.map((block) => [block.group.id, block.actions])).toEqual([
      ['email', ['send']],
    ]);
  });

  it('puts named tools under their group, after the named actions', () => {
    const blocks = selectionBlocks(CATALOG, {
      groups: [{ group: 'email', actions: ['send'] }],
      tools: [{ service: 'email', operation: 'send_message' }],
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].actions).toEqual(['send']);
    expect(blocks[0].tools.map((tool) => tool.operation)).toEqual([
      'send_message',
    ]);
  });

  it('gives a tool its own block when its group was not named', () => {
    const blocks = selectionBlocks(CATALOG, {
      groups: [],
      tools: [{ service: 'storage', operation: 'delete_document' }],
    });
    expect(blocks.map((block) => block.group.id)).toEqual(['documents']);
    expect(blocks[0].actions).toEqual([]);
  });

  it('leaves out groups and tools the catalog does not know', () => {
    expect(
      selectionBlocks(CATALOG, {
        groups: [{ group: 'nope' }],
        tools: [{ service: 'nope', operation: 'nope' }],
      })
    ).toEqual([]);
  });
});
