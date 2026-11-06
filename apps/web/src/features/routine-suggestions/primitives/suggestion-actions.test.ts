import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { ScheduleDraft } from '../../routines/core/draft';
import { createEmptyDraft } from '../../routines/core/routine-draft';
import { catalogTemplate } from '../../routines/queries/catalog';
import {
  createSuggestionActions,
  type SuggestionCapabilities,
} from './suggestion-actions';

vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock(
  '@property/identifiers',
  async () => await vi.importActual('@property/identifiers')
);
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'New routine',
}));

const INBOX = catalogTemplate({
  key: 'inbox',
  surface: 'email',
  title: 'Sort my inbox',
  description: 'AI labels new email by topic',
  request: 'Label new email.',
  action: 'Label with AI',
  trigger: {
    type: 'events',
    filters: [{ events: ['email.message_received'] }],
  },
  code: {
    type: 'code',
    title: 'Label by topic',
    summary: '',
    source: 'export async function main() {}',
  },
  namedKnobs: {},
  instructions: 'Label this email.',
  affectsOthers: false,
  safeDefault: true,
  template: true,
});

function capabilities(
  overrides: Partial<SuggestionCapabilities> = {}
): SuggestionCapabilities & { reviewed: ScheduleDraft[] } {
  const reviewed: ScheduleDraft[] = [];
  return {
    reviewed,
    catalog: () => [INBOX],
    defaultModel: () => 'model',
    codeSteps: () => true,
    workspace: () => ({ tag: [], channel: [], label: [] }),
    ensurePersonalTags: vi.fn(async () => {}),
    draft: vi.fn(async () => 'AI couldn’t draft that.'),
    review: (draft) => reviewed.push(draft),
    describe: vi.fn(),
    dismiss: vi.fn(),
    notify: vi.fn(),
    ...overrides,
  };
}

const starter = {
  id: 'starter-1',
  kind: 'starter' as const,
  key: 'inbox',
  knobs: {},
  surface: 'email' as const,
  reason: 'You file a lot of mail.',
  keepProbability: 0.9,
  safeDefault: true,
};

const request = {
  id: 'request-1',
  kind: 'request' as const,
  title: 'Supplier digest',
  request: 'Every Friday, list deliveries suppliers confirmed.',
  surface: 'crm' as const,
  reason: 'Suppliers write every week.',
  keepProbability: 0.4,
  safeDefault: false,
};

describe('suggestion actions', () => {
  it('open a catalog suggestion for review, unsaved, pointing back at it', async () => {
    const host = capabilities();
    await createRoot(async (dispose) => {
      await createSuggestionActions(host).review(starter);
      dispose();
    });
    expect(host.reviewed).toMatchObject([
      {
        name: 'Sort my inbox',
        suggestionId: 'starter-1',
        steps: [{ kind: 'code', title: 'Label by topic' }],
      },
    ]);
  });

  it('draft a request before review, and fall back to describing it when drafting fails', async () => {
    const drafted = {
      ...createEmptyDraft('model'),
      name: '',
      prompt: 'List deliveries.',
    };
    const host = capabilities({ draft: vi.fn(async () => drafted) });
    await createRoot(async (dispose) => {
      await createSuggestionActions(host).review(request);
      dispose();
    });
    expect(host.draft).toHaveBeenCalledWith(request.request);
    expect(host.reviewed).toMatchObject([
      {
        name: 'Supplier digest',
        description: request.request,
        suggestionId: 'request-1',
      },
    ]);

    const failing = capabilities();
    await createRoot(async (dispose) => {
      await createSuggestionActions(failing).review(request);
      dispose();
    });
    expect(failing.reviewed).toEqual([]);
    expect(failing.notify).toHaveBeenCalledWith('AI couldn’t draft that.');
    expect(failing.describe).toHaveBeenCalledWith(request.request);
  });

  it('say so when the catalog no longer has the routine', async () => {
    const host = capabilities({ catalog: () => [] });
    await createRoot(async (dispose) => {
      await createSuggestionActions(host).review(starter);
      dispose();
    });
    expect(host.reviewed).toEqual([]);
    expect(host.notify).toHaveBeenCalled();
  });

  it('provision personal tags before reviewing a routine that adds them', async () => {
    const host = capabilities({
      catalog: () => [{ ...INBOX, namedKnobs: { replyTag: 'tag' } }],
    });
    await createRoot(async (dispose) => {
      await createSuggestionActions(host).review(starter);
      dispose();
    });
    expect(host.ensurePersonalTags).toHaveBeenCalledOnce();
  });
});
