import { describe, expect, test } from 'bun:test';
import type { MacroClient } from '../../utils/client';
import { MemoryNamespace } from './namespace';

describe('memory', () => {
  test('edit sends the line edit with the revision it was based on', async () => {
    const bodies: unknown[] = [];
    const client = {
      cognition: {
        editExplicitMemory: async ({ body }: { body: unknown }) => {
          bodies.push(body);
          return {
            data: { content: 'Prefers metric units', revision: 4 },
          };
        },
      },
    } as unknown as MacroClient;

    const memory = await new MemoryNamespace(client).edit(
      { action: 'insert', line: 1, content: 'Prefers metric units' },
      3,
    );

    expect(bodies).toEqual([
      {
        edit: { action: 'insert', line: 1, content: 'Prefers metric units' },
        revision: 3,
      },
    ]);
    expect(memory).toEqual({ content: 'Prefers metric units', revision: 4 });
  });
});
