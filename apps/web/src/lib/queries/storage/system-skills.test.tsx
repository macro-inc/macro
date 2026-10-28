/**
 * @vitest-environment jsdom
 */

import { storageServiceClient } from '@service-storage/client';
import type { GetSystemSkillsHandler200 } from '@service-storage/generated/schemas/getSystemSkillsHandler200';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok, type Result } from 'neverthrow';
import { Suspense } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getSystemSkills: vi.fn(),
  },
}));

import { useSystemSkillsQuery } from './system-skills';

type SystemSkillsResult = Result<GetSystemSkillsHandler200, unknown>;

let testQueryClient: QueryClient;
let dispose: (() => void) | undefined;

function renderProbe() {
  let hook!: ReturnType<typeof useSystemSkillsQuery>;
  dispose = render(
    () => (
      <QueryClientProvider client={testQueryClient}>
        <Suspense fallback={<span data-testid="suspended" />}>
          {(() => {
            hook = useSystemSkillsQuery();
            return <span data-testid="probe">{hook.skills().length}</span>;
          })()}
        </Suspense>
      </QueryClientProvider>
    ),
    document.body
  );
  return () => hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  testQueryClient.clear();
  document.body.innerHTML = '';
});

describe('useSystemSkillsQuery', () => {
  it('does not suspend the caller while the skill list is in flight', () => {
    vi.mocked(storageServiceClient.getSystemSkills).mockReturnValue(
      new Promise<SystemSkillsResult>(() => {}) as ReturnType<
        typeof storageServiceClient.getSystemSkills
      >
    );

    const hook = renderProbe();

    expect(document.querySelector('[data-testid="suspended"]')).toBeNull();
    expect(document.querySelector('[data-testid="probe"]')?.textContent).toBe(
      '0'
    );
    expect(hook().getSystemSkill('system-skill-1')).toBeUndefined();
  });

  it('classifies ids once the list lands', async () => {
    let settle!: (value: SystemSkillsResult) => void;
    vi.mocked(storageServiceClient.getSystemSkills).mockReturnValue(
      new Promise<SystemSkillsResult>((resolve) => {
        settle = resolve;
      }) as ReturnType<typeof storageServiceClient.getSystemSkills>
    );

    const hook = renderProbe();
    settle(ok({ skills: [{ id: 'system-skill-1', name: 'Summarize' }] }));

    await vi.waitFor(() => {
      expect(hook().isSystemSkillId('system-skill-1')).toBe(true);
    });
    expect(hook().getSystemSkill('system-skill-1')?.name).toBe('Summarize');
    expect(hook().isSystemSkillId('some-document')).toBe(false);
  });
});
