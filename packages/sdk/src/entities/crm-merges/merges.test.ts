import { describe, expect, test } from 'bun:test';
import type { MacroClient } from '../../utils/client';
import { CrmMergeNamespace } from './merges';

const SURVIVOR = '0192d1a0-0000-7000-8000-000000000001';
const SOURCE = '0192d1a0-0000-7000-8000-000000000002';
const REVISION =
  '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

function recording() {
  const bodies: Array<Record<string, unknown>> = [];
  const client = {
    storage: {
      commitCrmMerge: async ({ body }: { body: Record<string, unknown> }) => {
        bodies.push(body);
        return { data: { mergeId: 'merge-1' } };
      },
    },
  } as unknown as MacroClient;
  return { bodies, merges: new CrmMergeNamespace(client) };
}

describe('crm merges', () => {
  test('commits one review under one request key, so a retry returns its first result', async () => {
    const { bodies, merges } = recording();
    const commit = {
      survivorId: SURVIVOR,
      sourceIds: [SOURCE],
      revision: REVISION,
    };

    await merges.mergeCompanies(commit);
    await merges.mergeCompanies(commit);

    expect(bodies[0]?.requestKey).toBe('9f86d081-884c-7d65-9a2f-eaa0c55ad015');
    expect(bodies[1]?.requestKey).toBe(bodies[0]?.requestKey);
  });

  test('keeps a request key the caller names', async () => {
    const { bodies, merges } = recording();
    const requestKey = '0192d1a0-0000-7000-8000-0000000000ff';

    await merges.mergeCompanies({
      survivorId: SURVIVOR,
      sourceIds: [SOURCE],
      revision: REVISION,
      requestKey,
    });

    expect(bodies[0]?.requestKey).toBe(requestKey);
  });
});
