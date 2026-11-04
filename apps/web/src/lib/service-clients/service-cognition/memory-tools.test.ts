import { describe, expect, it } from 'vitest';
import {
  deserializeToolCall,
  deserializeToolResponse,
  type NamedTool,
} from './generated/tools/tool';

describe('memory tool contracts', () => {
  it('preserves the revision and accepts deletion without content', () => {
    const edit = {
      revision: 7,
      edit: { action: 'delete', line: 2 },
    } satisfies NamedTool<'UpdateMemory', 'call'>['data'];
    const parsed = deserializeToolCall({
      id: 'memory-edit',
      name: 'UpdateMemory',
      json: edit,
    });
    expect(parsed.isOk() && parsed.value.data).toEqual(edit);
    expect(
      deserializeToolCall({
        id: 'missing-revision',
        name: 'UpdateMemory',
        json: { edit: edit.edit },
      }).isErr()
    ).toBe(true);
  });

  it('parses empty activity and private memory responses', () => {
    const activity = { reports: [] } satisfies NamedTool<
      'GetUserActivity',
      'response'
    >['data'];
    expect(
      deserializeToolResponse({
        id: 'activity',
        name: 'GetUserActivity',
        json: activity,
      }).isOk()
    ).toBe(true);
    expect(
      deserializeToolResponse({
        id: 'memory-read',
        name: 'ReadMemory',
        json: { content: 'Use concise answers.', revision: 7 },
      }).isOk()
    ).toBe(true);
  });
});
