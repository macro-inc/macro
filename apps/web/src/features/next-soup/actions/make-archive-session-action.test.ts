import type { EntityData } from '@entity';
import { describe, expect, it, vi } from 'vitest';

const archive = vi.hoisted(() => vi.fn(async () => true));
vi.mock(
  '@app/features/block-agent/queries/change-session-archive-state',
  () => ({
    changeSessionArchiveState: archive,
  })
);

import { makeArchiveSessionAction } from './make-archive-session-action';

const ME = 'macro|me@macro.com';

const session = (overrides: Partial<EntityData> = {}) =>
  ({
    type: 'agent_session',
    id: 's1',
    name: 'Session',
    ownerId: ME,
    ...overrides,
  }) as EntityData;

const action = makeArchiveSessionAction({ userId: () => ME });

describe('makeArchiveSessionAction', () => {
  it('offers archiving only to the session owner', () => {
    expect(action.canExecute(session())).toBe(true);
    expect(action.canExecute(session({ ownerId: 'macro|other' }))).toBe(false);
    expect(
      action.canExecute({ ...session(), type: 'chat' } as EntityData)
    ).toBe(false);
  });

  it('archives an active session and unarchives an archived one', async () => {
    await action.execute([session()]);
    expect(archive).toHaveBeenLastCalledWith('s1', true);

    await action.execute([
      session({ isArchived: true } as Partial<EntityData>),
    ]);
    expect(archive).toHaveBeenLastCalledWith('s1', false);
  });
});
