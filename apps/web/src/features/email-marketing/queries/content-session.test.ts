import { expect, it, vi } from 'vitest';

const { createSession, dispose } = vi.hoisted(() => ({
  createSession: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('@core/collab-surface/createCollabSurface', () => ({
  createCollabSurfaceSession: createSession,
}));

import { sequenceContentId } from '../core/content-identity';
import { createSequenceContentSession } from './content-session';

it('uses the campaign database permission parent and preserves shared session lifecycle', () => {
  const options = {
    databaseId: 'database-id',
    campaignId: 'campaign-id',
    stepId: 'welcome',
    field: 'body' as const,
    initialText: 'Hi {{firstName}}',
  };
  const session = {
    loroManager: {},
    syncSource: () => undefined,
    connectionError: () => undefined,
    dispose,
  };
  createSession.mockReturnValue(session);
  const result = createSequenceContentSession(options);
  expect(createSession).toHaveBeenCalledWith(sequenceContentId(options), {
    parent: { entityType: 'database', entityId: 'database-id' },
    initialMarkdown: options.initialText,
  });
  expect(result.sourceId).toBe(sequenceContentId(options));
  expect(result.loroManager).toBe(session.loroManager);
  result.dispose();
  expect(dispose).toHaveBeenCalledOnce();
});
