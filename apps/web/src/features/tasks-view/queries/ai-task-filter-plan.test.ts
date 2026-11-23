import type { ContactReferenceReader } from '@queries/contacts/reference-reader';
import type { ContactReferenceResolution } from '@queries/contacts/references';
import { ok } from 'neverthrow';
import { createRoot } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { useAiTaskFilterPlan } from './ai-task-filter-plan';

const mocks = vi.hoisted(() => ({
  completion: vi.fn(),
  read: vi.fn<ContactReferenceReader>(),
  dispose: vi.fn(),
  session: 0,
}));
vi.mock('@service-cognition/client', () => ({
  dcsCompletion: mocks.completion,
}));
vi.mock('@queries/auth/use-query-account', () => ({
  useQueryAccount: () => () => ({
    userId: 'macro|viewer@example.com',
    session: mocks.session,
  }),
}));
vi.mock('@queries/auth/account-scope', () => ({
  isCurrentQueryAccount: (owner: { session: number }) =>
    owner.session === mocks.session,
}));
vi.mock('@queries/contacts/use-directory', () => ({
  useContactDirectoryScope: () => () => ({
    userId: 'macro|viewer@example.com',
  }),
}));
vi.mock('@queries/contacts/reference-reader', () => ({
  createContactReferenceReader: () => ({
    read: mocks.read,
    dispose: mocks.dispose,
  }),
}));

const catalog = { viewer: '@viewer', tags: [] };
const reply = {
  status: ['completed'],
  priority: [],
  assignees: ['Family, Given'],
  createdBy: ['@viewer'],
  tags: [],
  search: '',
  unresolved: '',
};
const evidence: ContactReferenceResolution = {
  source: 'server',
  offline: false,
  matches: [
    {
      complete: true,
      people: [
        {
          userId: 'macro|person@example.com',
          email: 'person@example.com',
          name: 'Family, Given',
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = 0;
  mocks.completion.mockResolvedValue(
    ok({ choices: [{ message: { content: JSON.stringify(reply) } }] })
  );
  mocks.read.mockResolvedValue(evidence);
});

it('reads only extracted labels, without splitting names or looking up the viewer token', async () => {
  const root = createRoot((dispose) => ({
    request: useAiTaskFilterPlan(),
    dispose,
  }));
  try {
    const result = await root.request('assigned tasks', catalog, () => true);
    expect(result.isOk() && result.value.facets).toEqual({
      status: ['completed'],
      assignees: ['macro|person@example.com'],
      'created-by': ['@viewer'],
    });
    expect(mocks.read).toHaveBeenCalledWith(
      'macro|viewer@example.com',
      undefined,
      {
        labels: ['Family, Given'],
        matching: 'preferFullName',
        excludeSecondaryInboxes: false,
      },
      expect.any(AbortSignal)
    );
  } finally {
    root.dispose();
  }
});

it('keeps partial and ambiguous evidence unresolved instead of applying broader filters', async () => {
  const root = createRoot((dispose) => ({
    request: useAiTaskFilterPlan(),
    dispose,
  }));
  try {
    for (const match of [
      { complete: false, people: evidence.matches[0].people },
      {
        complete: true,
        people: [
          ...evidence.matches[0].people,
          {
            userId: 'macro|other@example.com',
            email: 'other@example.com',
            name: 'Family, Given',
          },
        ],
      },
    ]) {
      mocks.read.mockResolvedValueOnce({ ...evidence, matches: [match] });
      const result = await root.request('assigned tasks', catalog, () => true);
      expect(result.isErr() && result.error.code).toBe('UNRESOLVED_PEOPLE');
    }
  } finally {
    root.dispose();
  }
});

it('discards identity proof arriving after a replacement login or disposal', async () => {
  for (const change of ['account', 'dispose']) {
    const started = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<ContactReferenceResolution>();
    mocks.read.mockImplementationOnce(async () => {
      started.resolve();
      return await finished.promise;
    });
    const root = createRoot((dispose) => ({
      request: useAiTaskFilterPlan(),
      dispose,
    }));
    const pending = root.request('assigned tasks', catalog, () => true);
    await started.promise;
    if (change === 'account') mocks.session++;
    else root.dispose();
    finished.resolve(evidence);
    const result = await pending;
    expect(result.isErr() && result.error.code).toBe('STALE');
    if (change === 'account') root.dispose();
  }
});

it('only allows the latest overlapping extraction to read people and return a plan', async () => {
  const first =
    Promise.withResolvers<Awaited<ReturnType<typeof mocks.completion>>>();
  mocks.completion.mockImplementationOnce(async () => await first.promise);
  const root = createRoot((dispose) => ({
    request: useAiTaskFilterPlan(),
    dispose,
  }));
  try {
    const old = root.request('old', catalog, () => true);
    const current = await root.request('new', catalog, () => true);
    expect(current.isOk()).toBe(true);
    first.resolve(
      ok({ choices: [{ message: { content: JSON.stringify(reply) } }] })
    );
    const discarded = await old;
    expect(discarded.isErr() && discarded.error.code).toBe('STALE');
    expect(mocks.read).toHaveBeenCalledTimes(1);
  } finally {
    root.dispose();
  }
});
