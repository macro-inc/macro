import { describe, expect, it, vi } from 'vitest';
import {
  compositionInstructions,
  draftFromComposition,
} from './compose-routine';
import { draftToCreateBody } from './routine-draft';

vi.mock('@service-cognition/client', () => ({ cognitionApiServiceClient: {} }));
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'New routine',
}));

const context = { defaultModel: 'claude', decisions: true };

describe('routine composition', () => {
  it('turns triage into an event routine with steps', () => {
    const draft = draftFromComposition(
      {
        name: 'Inbox triage',
        triggers: [
          {
            type: 'event',
            events: ['email.message_received'],
            condition: null,
          },
        ],
        steps: [
          {
            type: 'choose',
            question: 'What kind of email is this?',
            options: [
              {
                label: 'Newsletter',
                steps: [
                  {
                    type: 'tool',
                    tool: 'UpdateThreadLabels',
                    arguments: {
                      thread_id: '{{trigger.entity_id}}',
                      label: 'INBOX',
                      add: false,
                    },
                  },
                ],
              },
              { label: 'Invoice', steps: [] },
            ],
          },
        ],
      },
      context
    );
    if (typeof draft === 'string') throw new Error(draft);
    expect(draft.name).toBe('Inbox triage');
    expect(draft.triggers).toMatchObject([
      { kind: 'event', events: ['email.message_received'] },
    ]);
    expect(draft.steps?.[0]?.kind).toBe('choose');
  });

  it('keeps a trigger limited to the items it names', () => {
    const channel = '0195f5d1-4c4b-7a3e-9b3f-2d6a1c8e9f01';
    const draft = draftFromComposition(
      {
        name: 'Copy launches',
        triggers: [
          {
            type: 'event',
            events: ['channel.message_posted'],
            ids: [channel],
          },
        ],
        steps: [
          {
            type: 'tool',
            tool: 'CreateDocument',
            arguments: {
              documentName: 'Launch note',
              fileContent: '',
              fileExtension: 'md',
            },
          },
        ],
      },
      context
    );
    if (typeof draft === 'string') throw new Error(draft);
    // Saving it watches that one channel, not every channel.
    expect(JSON.stringify(draftToCreateBody(draft))).toContain(channel);
  });

  it('keeps choices that apply every fitting option', () => {
    const label = (name: string) => ({
      label: name,
      steps: [
        {
          type: 'tool',
          tool: 'UpdateThreadLabels',
          arguments: {
            thread_id: '{{trigger.entity_id}}',
            label: name,
            add: true,
          },
        },
      ],
    });
    const draft = draftFromComposition(
      {
        name: 'Label by topic',
        triggers: [{ type: 'event', events: ['email.message_received'] }],
        steps: [
          {
            type: 'choose',
            multiple: true,
            options: [label('Finance'), label('Hiring')],
          },
        ],
      },
      context
    );
    if (typeof draft === 'string') throw new Error(draft);
    expect(draft.steps?.[0]).toMatchObject({ kind: 'choose', multiple: true });
  });

  it('keeps a single agent routine in the simple form', () => {
    const draft = draftFromComposition(
      {
        name: 'Daily brief',
        triggers: [
          { type: 'cron', expression: '0 0 9 * * *', timezone: 'UTC' },
        ],
        steps: [
          { type: 'agent', model: 'claude', instructions: 'Summarize my day' },
        ],
      },
      context
    );
    if (typeof draft === 'string') throw new Error(draft);
    expect(draft.steps).toBeUndefined();
    expect(draft.prompt).toBe('Summarize my day');
    expect(draft.triggers?.[0]).toMatchObject({
      kind: 'schedule',
      frequency: 'day',
    });
  });

  it('explains drafts it cannot use', () => {
    expect(draftFromComposition({ name: 'x' }, context)).toMatch(/incomplete/);
    expect(
      draftFromComposition(
        {
          name: 'x',
          triggers: [],
          steps: [{ type: 'tool', tool: 'DeleteEverything', arguments: {} }],
        },
        context
      )
    ).toMatch(/can’t run/);
  });

  it('tells the model which names and ids it may use', () => {
    const instructions = compositionInstructions({
      now: new Date('2026-10-09T12:00:00Z'),
      timezone: 'America/New_York',
      defaultModel: 'claude',
      userId: 'macro|me@example.com',
      labels: ['Finance'],
      tags: [{ label: 'Urgent', definitionId: 'd', optionId: 'o' }],
      channels: [{ name: 'billing', id: 'c' }],
      folders: [{ name: 'Receipts', id: 'f' }],
      people: [{ name: 'Ada', id: 'macro|ada@example.com' }],
      agents: [],
      decisions: false,
    });
    expect(instructions).toContain('"Finance"');
    expect(instructions).toContain('"billing"');
    expect(instructions).toContain('"Receipts"');
    expect(instructions).toContain('macro|ada@example.com');
    expect(instructions).toContain('Decisions are unavailable');
    expect(instructions).toContain('2026-10-09T12:00:00.000Z');
  });

  it('refuses a draft that needs AI decisions when they are off', () => {
    const withDecision = {
      name: 'Inbox triage',
      triggers: [{ type: 'event', events: ['email.message_received'] }],
      steps: [
        {
          type: 'if',
          condition: 'Is it a newsletter?',
          // biome-ignore lint/suspicious/noThenProperty: the scheduler's step format names the yes branch `then`.
          then: [],
          else: [],
        },
      ],
    };
    const withCondition = {
      name: 'Invoices',
      triggers: [
        {
          type: 'event',
          events: ['email.message_received'],
          condition: 'Is it an invoice?',
        },
      ],
      steps: [{ type: 'agent', instructions: 'File it', model: 'claude' }],
    };
    for (const output of [withDecision, withCondition]) {
      expect(
        draftFromComposition(output, { ...context, decisions: false })
      ).toMatch(/needs AI to decide/);
      expect(typeof draftFromComposition(output, context)).not.toBe('string');
    }
  });
});
