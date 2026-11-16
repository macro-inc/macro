import { describe, expect, test } from 'bun:test';
import type { MacroClient } from '../../utils/client';
import { WorkspaceQuery } from './query';

describe('workspace query', () => {
  test('opts into agent sessions with the unit literal the server reads', async () => {
    const query = new WorkspaceQuery({} as MacroClient);

    const body = await query.body({ includeTypes: ['agent_session'] });

    // The server's `AgentSessionLiteral::Include` is a unit variant: `"inc"`,
    // never `{ inc: true }`, which it refuses with 422.
    expect(body.asf).toEqual({ l: 'inc' });
  });
});
