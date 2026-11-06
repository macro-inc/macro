import { describe, expect, it, vi } from 'vitest';
import { createEmptyDraft } from '../../routines/core/routine-draft';
import { catalogTemplate } from '../../routines/queries/catalog';
import {
  type StarterSuggestion,
  starterSuggestionDraft,
  suggestionSummary,
} from './suggestion-draft';

vi.mock(
  '@property/identifiers',
  async () => await vi.importActual('@property/identifiers')
);
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'New routine',
}));

const TAGS = catalogTemplate({
  key: 'email_tags',
  surface: 'email',
  title: 'Tag new email',
  description: 'AI tags new email Reply, Followup, Action or FYI',
  request: 'When a new email arrives, tag it.',
  action: 'Tag with AI',
  trigger: {
    type: 'events',
    filters: [{ events: ['email.message_received'] }],
  },
  code: {
    type: 'code',
    title: 'Tag by what it needs',
    summary: '',
    source: 'export async function main() {}',
    knobs: [
      { type: 'text', name: 'replyTag', label: 'Reply tag', value: 'Reply' },
      { type: 'text', name: 'fyiTag', label: 'FYI tag', value: 'FYI' },
      {
        type: 'number',
        name: 'days',
        label: 'Days',
        value: 7,
        min: 1,
        max: 60,
      },
    ],
    sentence: 'Tag each new email {replyTag} or {fyiTag} within {days} days.',
  },
  namedKnobs: { replyTag: 'tag', fyiTag: 'tag' },
  instructions: 'Tag this email.',
  affectsOthers: false,
  safeDefault: true,
  template: true,
});

const suggestion: StarterSuggestion = {
  id: 'suggestion-1',
  kind: 'starter',
  key: 'email_tags',
  knobs: { fyiTag: 'info', days: 14 },
  surface: 'email',
  reason: 'You get a lot of newsletters.',
  keepProbability: 0.9,
  safeDefault: true,
};

const base = { ...createEmptyDraft('model'), triggers: [], enabled: true };
const target = { kind: 'model' as const, model: 'model' };

describe('starter suggestion drafts', () => {
  it('start from the catalog routine with AI’s knobs, matched to the person’s tags', () => {
    const { draft, missing } = starterSuggestionDraft(suggestion, TAGS, base, {
      target,
      codeSteps: true,
      workspace: { tag: ['Info', 'Later'], channel: [], label: [] },
    });
    expect(draft).toMatchObject({
      name: 'Tag new email',
      suggestionId: 'suggestion-1',
      triggers: [{ kind: 'event', events: ['email.message_received'] }],
    });
    const [step] = draft.steps ?? [];
    expect(step?.kind === 'code' && step.knobs).toMatchObject([
      // The person has no Reply tag; the routine makes it on first use.
      { name: 'replyTag', value: 'Reply' },
      // AI wrote "info"; the person's own tag is "Info".
      { name: 'fyiTag', value: 'Info' },
      { name: 'days', value: 14 },
    ]);
    expect(missing).toEqual([{ knob: 'replyTag', kind: 'tag', name: 'Reply' }]);
  });

  it('start as Ask AI with the catalog’s instructions where code is off', () => {
    const { draft } = starterSuggestionDraft(suggestion, TAGS, base, {
      target,
      codeSteps: false,
      workspace: { tag: [], channel: [], label: [] },
    });
    expect(draft.steps).toBeUndefined();
    expect(draft.prompt).toBe('Tag this email.');
    expect(draft.suggestionId).toBe('suggestion-1');
  });

  it('say what they do with the suggested values', () => {
    expect(suggestionSummary(suggestion, TAGS)).toEqual({
      title: 'Tag new email',
      does: 'Tag each new email Reply or info within 14 days.',
      when: 'New email received',
    });
    expect(
      suggestionSummary(
        {
          id: 'suggestion-2',
          kind: 'request',
          title: 'Supplier digest',
          request: 'Every Friday, list deliveries suppliers confirmed.',
          surface: 'crm',
          reason: 'Suppliers write every week.',
          keepProbability: 0.4,
          safeDefault: false,
        },
        undefined
      )
    ).toEqual({
      title: 'Supplier digest',
      does: 'Every Friday, list deliveries suppliers confirmed.',
    });
  });
});
