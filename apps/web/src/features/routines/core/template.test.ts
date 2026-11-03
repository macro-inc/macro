import { describe, expect, it } from 'vitest';
import { createEmptyDraft } from './routine-draft';
import {
  extractTemplateVariables,
  fillTemplatePrompt,
  fillTemplateTrigger,
  templateShareBody,
} from './template';

const AUTHOR =
  '<m-user-mention>{"userId":"macro|eric@macro.com","email":"eric@macro.com","displayName":"Eric"}</m-user-mention>';
const TEAMMATE =
  '<m-user-mention>{"userId":"macro|priya@macro.com","email":"priya@macro.com","displayName":"Priya Shah"}</m-user-mention>';
const CHANNEL =
  '<m-document-mention>{"documentId":"channel-1","documentName":"customer-success","blockName":"channel"}</m-document-mention>';
const DOC =
  '<m-document-mention>{"documentId":"doc-1","documentName":"Acme account","blockName":"md"}</m-document-mention>';

const PROMPT = `Post the digest to ${CHANNEL}. Pull renewal dates from ${DOC}. Assign follow-ups to ${TEAMMATE} and DM ${AUTHOR} a summary. Repeat in ${CHANNEL}.`;

const CRON = {
  type: 'cron' as const,
  schedule: '0 0 9 * * 2',
  timezone: 'America/Los_Angeles',
};

const ACTIVATOR = {
  userId: 'macro|jun@macro.com',
  email: 'jun@macro.com',
  displayName: 'Jun',
  timezone: 'America/New_York',
};

describe('extractTemplateVariables', () => {
  it('fills the author and time zone as the activator and keeps other references', () => {
    expect(
      extractTemplateVariables({
        prompt: PROMPT,
        timezone: CRON.timezone,
        authorId: 'macro|eric@macro.com',
      })
    ).toEqual([
      {
        kind: 'item',
        id: 'channel-1',
        block_name: 'channel',
        label: 'customer-success',
        fill: 'shared',
      },
      {
        kind: 'item',
        id: 'doc-1',
        block_name: 'md',
        label: 'Acme account',
        fill: 'shared',
      },
      {
        kind: 'user',
        id: 'macro|priya@macro.com',
        label: 'Priya Shah',
        fill: 'shared',
      },
      {
        kind: 'user',
        id: 'macro|eric@macro.com',
        label: 'Eric',
        fill: 'activator',
      },
      { kind: 'time_zone', timezone: 'America/Los_Angeles', fill: 'activator' },
    ]);
  });

  it('has no time zone for event-only routines', () => {
    expect(
      extractTemplateVariables({
        prompt: 'Summarize it',
        timezone: undefined,
        authorId: 'macro|eric@macro.com',
      })
    ).toEqual([]);
  });
});

describe('fillTemplatePrompt', () => {
  const variables = extractTemplateVariables({
    prompt: PROMPT,
    timezone: CRON.timezone,
    authorId: 'macro|eric@macro.com',
  });

  it('names the activator in place of the author and leaves out dropped references as text', () => {
    const filled = fillTemplatePrompt({
      prompt: PROMPT,
      variables,
      activator: ACTIVATOR,
      choices: new Map([['doc-1', 'leave_out']]),
    });
    expect(filled).toBe(
      `Post the digest to ${CHANNEL}. Pull renewal dates from Acme account. Assign follow-ups to ${TEAMMATE} and DM <m-user-mention>{"userId":"macro|jun@macro.com","email":"jun@macro.com","displayName":"Jun"}</m-user-mention> a summary. Repeat in ${CHANNEL}.`
    );
  });

  it('leaves out an unchosen per-person reference', () => {
    const filled = fillTemplatePrompt({
      prompt: `Read ${DOC}`,
      variables: [
        {
          kind: 'item',
          id: 'doc-1',
          block_name: 'md',
          label: 'Acme account',
          fill: 'choice',
        },
      ],
      activator: ACTIVATOR,
      choices: new Map(),
    });
    expect(filled).toBe('Read Acme account');
  });
});

describe('fillTemplateTrigger', () => {
  it('moves every schedule to the activator time zone', () => {
    const trigger = {
      type: 'multiple' as const,
      triggers: [CRON, { type: 'events' as const, filters: [] }],
    };
    expect(
      fillTemplateTrigger({
        trigger,
        variables: [
          { kind: 'time_zone', timezone: CRON.timezone, fill: 'activator' },
        ],
        activator: ACTIVATOR,
      })
    ).toEqual({
      type: 'multiple',
      triggers: [
        { ...CRON, timezone: 'America/New_York' },
        { type: 'events', filters: [] },
      ],
    });
  });

  it('keeps the author time zone when it is shared', () => {
    expect(
      fillTemplateTrigger({
        trigger: CRON,
        variables: [
          { kind: 'time_zone', timezone: CRON.timezone, fill: 'shared' },
        ],
        activator: ACTIVATOR,
      })
    ).toEqual(CRON);
  });
});

describe('templateShareBody', () => {
  it('keeps the shared template’s fills and description for references the routine still has', () => {
    const draft = {
      ...createEmptyDraft(''),
      target: { kind: 'agent' as const, agentId: 'agent-1' },
    };
    expect(
      templateShareBody({
        draft: { ...draft, prompt: PROMPT, timezone: CRON.timezone },
        authorId: 'macro|eric@macro.com',
        shared: {
          active_count: 2,
          author: 'macro|eric@macro.com',
          created_at: '2026-10-01T00:00:00Z',
          description: 'Weekly renewals digest',
          id: 'routine-1',
          name: 'Renewals',
          task: { user_prompt: PROMPT },
          trigger: CRON,
          updated_at: '2026-10-01T00:00:00Z',
          variables: [
            {
              kind: 'item',
              id: 'doc-1',
              block_name: 'md',
              label: 'Acme account',
              fill: 'choice',
            },
            {
              kind: 'item',
              id: 'doc-removed',
              block_name: 'md',
              label: 'Old notes',
              fill: 'choice',
            },
          ],
        },
      })
    ).toEqual({
      description: 'Weekly renewals digest',
      variables: [
        {
          kind: 'item',
          id: 'channel-1',
          block_name: 'channel',
          label: 'customer-success',
          fill: 'shared',
        },
        {
          kind: 'item',
          id: 'doc-1',
          block_name: 'md',
          label: 'Acme account',
          fill: 'choice',
        },
        {
          kind: 'user',
          id: 'macro|priya@macro.com',
          label: 'Priya Shah',
          fill: 'shared',
        },
        {
          kind: 'user',
          id: 'macro|eric@macro.com',
          label: 'Eric',
          fill: 'activator',
        },
        {
          kind: 'time_zone',
          timezone: CRON.timezone,
          fill: 'activator',
        },
      ],
    });
  });
});
