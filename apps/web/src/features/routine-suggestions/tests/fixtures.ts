import type { RoutineSuggestion } from '@service-scheduled-action/generated/schemas';
import { newRoutineDraft } from '../../routines/core/routine-templates';
import { catalogTemplate } from '../../routines/queries/catalog';

/** Synthetic suggestions and the catalog routine they start from. */
export const TAGS = catalogTemplate({
  key: 'email_tags',
  surfaces: ['email', 'agents'],
  title: 'Tag new email',
  description: 'AI tags new email Reply or FYI',
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
      {
        type: 'number',
        name: 'days',
        label: 'Days',
        value: 7,
        min: 1,
        max: 60,
      },
    ],
    sentence: 'Tag each new email {replyTag} within {days} days.',
  },
  namedKnobs: { replyTag: 'tag' },
  instructions: 'Tag this email.',
  affectsOthers: false,
  safeDefault: true,
  suggest: true,
  template: true,
});

export const context = (codeSteps: boolean) => ({
  target: { kind: 'model' as const, model: 'model' },
  codeSteps,
  base: newRoutineDraft(undefined, { defaultModel: 'model', codeSteps }),
});

export const forYou: RoutineSuggestion = {
  id: 'pick-1',
  kind: 'catalog',
  key: 'email_tags',
  knobs: { replyTag: 'Respond', days: 14 },
  from: 'for_you',
  surfaces: ['email', 'agents'],
  reason: 'You answer most mail within a day.',
  keepProbability: 0.9,
  onByDefault: true,
};

export const template: RoutineSuggestion = {
  id: 'template-1',
  kind: 'catalog',
  key: 'email_tags',
  knobs: {},
  from: 'macro',
  surfaces: ['email'],
  reason: null,
  keepProbability: null,
  onByDefault: false,
};

export const drafted: RoutineSuggestion = {
  id: 'drafted-1',
  kind: 'routine',
  from: 'for_you',
  surfaces: ['crm'],
  reason: 'Suppliers write every week.',
  keepProbability: 0.5,
  onByDefault: false,
  routine: {
    name: 'Supplier digest',
    description: 'Every Friday, list the deliveries suppliers confirmed.',
    enabled: false,
    kind: 'Agent',
    run_visibility: 'listed',
    trigger: {
      type: 'events',
      filters: [{ events: ['email.message_received'] }],
    },
    task: {
      steps: [
        {
          type: 'agent',
          model: 'model',
          instructions: 'List the deliveries suppliers confirmed.',
        },
      ],
    },
  } as never,
};
