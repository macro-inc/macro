import type { RoutineTemplate } from '@service-scheduled-action/generated/schemas';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createTemplateActivation } from './template-activation';

const DOC =
  '<m-document-mention>{"documentId":"doc-1","documentName":"Acme account","blockName":"md"}</m-document-mention>';

const TEMPLATE: RoutineTemplate = {
  id: 'template-1',
  author: 'macro|eric@macro.com',
  name: 'Weekly digest',
  description: '',
  active_count: 0,
  created_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-20T00:00:00Z',
  trigger: { type: 'cron', schedule: '0 0 9 * * 2', timezone: 'UTC' },
  task: { model: 'model', prompt: '', user_prompt: `Read ${DOC}` },
  variables: [
    {
      kind: 'item',
      id: 'doc-1',
      block_name: 'md',
      label: 'Acme account',
      fill: 'shared',
    },
    { kind: 'time_zone', timezone: 'UTC', fill: 'activator' },
  ],
};

const ACTIVATOR = {
  userId: 'macro|jun@macro.com',
  email: 'jun@macro.com',
  timezone: 'America/New_York',
};

describe('createTemplateActivation', () => {
  it('waits for a decision on an item the activator cannot open', () => {
    createRoot((dispose) => {
      const [access, setAccess] = createSignal<ReadonlyMap<string, boolean>>(
        new Map([['doc-1', true]])
      );
      const activation = createTemplateActivation({
        template: () => TEMPLATE,
        activator: () => ACTIVATOR,
        access,
      });
      expect(activation.request()).toEqual({
        name: 'Weekly digest',
        trigger: {
          type: 'cron',
          schedule: '0 0 9 * * 2',
          timezone: 'America/New_York',
        },
        kind: 'Agent',
        task: { model: 'model', prompt: '', user_prompt: `Read ${DOC}` },
        enabled: true,
        run_visibility: 'unlisted',
      });

      setAccess(new Map([['doc-1', false]]));
      expect(activation.undecided().map((reference) => reference.key)).toEqual([
        'doc-1',
      ]);
      expect(activation.request()).toBeUndefined();

      activation.choose('doc-1', 'leave_out');
      expect(activation.request()?.task).toEqual({
        model: 'model',
        prompt: '',
        user_prompt: 'Read Acme account',
      });
      dispose();
    });
  });

  it('fills a routine with steps on its agent step and keeps its actions', () => {
    createRoot((dispose) => {
      const label = {
        type: 'tool',
        tool: 'UpdateThreadLabels',
        arguments: {
          thread_id: '{{trigger.entity_id}}',
          label: 'Finance',
          add: true,
        },
      };
      const apps = [{ app_slug: 'linear', server_name: 'Linear' }];
      const activation = createTemplateActivation({
        template: () => ({
          ...TEMPLATE,
          task: {
            steps: [
              label,
              { type: 'agent', model: 'model', instructions: `Read ${DOC}` },
            ],
            mcp_servers: apps,
          },
        }),
        activator: () => ACTIVATOR,
        access: () => new Map([['doc-1', false]]),
      });
      expect(activation.prompt()).toBe(`Read ${DOC}`);
      activation.choose('doc-1', 'leave_out');
      expect(activation.request()?.task).toEqual({
        steps: [
          label,
          { type: 'agent', model: 'model', instructions: 'Read Acme account' },
        ],
        mcp_servers: apps,
      });
      dispose();
    });
  });

  it('assigns to the activator what the author assigned to themselves', () => {
    createRoot((dispose) => {
      const assign = (entityId: string) => ({
        type: 'tool',
        tool: 'SetEntityProperty',
        arguments: {
          entity_id: '{{trigger.entity_id}}',
          entity_type: 'document',
          property_definition_id: 'assignees',
          entity_refs: [{ entityType: 'user', entityId }],
        },
      });
      const activation = createTemplateActivation({
        template: () => ({
          ...TEMPLATE,
          task: {
            steps: [
              assign('macro|eric@macro.com'),
              assign('macro|sam@macro.com'),
            ],
          },
          variables: [],
        }),
        activator: () => ACTIVATOR,
        access: () => new Map(),
      });
      const task = activation.request()?.task as
        | { steps: unknown[] }
        | undefined;
      const steps = task?.steps ?? [];
      expect(JSON.stringify(steps[0])).toContain('macro|jun@macro.com');
      expect(JSON.stringify(steps[0])).not.toContain('eric@macro.com');
      // Someone else the author chose stays as chosen.
      expect(JSON.stringify(steps[1])).toContain('macro|sam@macro.com');
      dispose();
    });
  });

  it('keeps the author where they shared themselves, and leaves other text alone', () => {
    createRoot((dispose) => {
      const activation = createTemplateActivation({
        template: () => ({
          ...TEMPLATE,
          task: {
            steps: [
              {
                type: 'tool',
                tool: 'SetEntityProperty',
                arguments: {
                  entity_id: '{{trigger.entity_id}}',
                  entity_type: 'document',
                  property_definition_id: 'assignees',
                  entity_refs: [
                    { entityType: 'user', entityId: 'macro|eric@macro.com' },
                  ],
                },
              },
              {
                type: 'tool',
                tool: 'SetSenderPolicy',
                arguments: { sender_email: 'eric@macro.com', policy: 'noise' },
              },
            ],
          },
          variables: [
            {
              kind: 'user',
              id: 'macro|eric@macro.com',
              label: 'eric@macro.com',
              fill: 'shared',
            },
          ],
        }),
        activator: () => ACTIVATOR,
        access: () => new Map(),
      });
      const text = JSON.stringify(activation.request()?.task);
      expect(text).toContain('"entityId":"macro|eric@macro.com"');
      expect(text).toContain('"sender_email":"eric@macro.com"');
      expect(text).not.toContain('jun@macro.com');
      dispose();
    });
  });

  it('empties steps aimed at what the activator can’t open, and starts off', () => {
    createRoot((dispose) => {
      const [access, setAccess] = createSignal<ReadonlyMap<string, boolean>>(
        new Map()
      );
      const activation = createTemplateActivation({
        template: () => ({
          ...TEMPLATE,
          task: {
            steps: [
              {
                type: 'tool',
                tool: 'SendChannelMessage',
                arguments: { channel_id: 'private', content: 'Done' },
              },
              {
                type: 'tool',
                tool: 'CreateDocument',
                arguments: { documentName: 'Notes', projectId: 'shared' },
              },
            ],
          },
          variables: [],
        }),
        activator: () => ACTIVATOR,
        access,
      });
      // Until access is known, there's nothing to activate.
      expect(activation.checking()).toBe(true);
      expect(activation.request()).toBeUndefined();
      setAccess(
        new Map([
          ['private', false],
          ['shared', true],
        ])
      );
      expect(activation.unreachable()).toEqual([
        { id: 'private', blockName: 'channel' },
      ]);
      const body = activation.request();
      expect(body?.enabled).toBe(false);
      expect(body?.task).toMatchObject({
        steps: [
          { arguments: { channel_id: '' } },
          { arguments: { projectId: 'shared' } },
        ],
      });
      dispose();
    });
  });

  it('can’t activate a step acting on a document the activator can’t open', () => {
    createRoot((dispose) => {
      const activation = createTemplateActivation({
        template: () => ({
          ...TEMPLATE,
          task: {
            steps: [
              {
                type: 'tool',
                tool: 'Comment',
                arguments: {
                  entityType: 'document',
                  entityId: 'private-doc',
                  content: 'Weekly check-in',
                },
              },
            ],
          },
          variables: [],
        }),
        activator: () => ACTIVATOR,
        access: () => new Map([['private-doc', false]]),
      });
      expect(activation.blocked()).toEqual([
        { id: 'private-doc', blockName: 'md' },
      ]);
      expect(activation.request()).toBeUndefined();
      dispose();
    });
  });

  it('asks for a tag where the author’s can’t be applied, and starts off', () => {
    createRoot((dispose) => {
      const [tags, setTags] = createSignal<ReadonlySet<string> | undefined>();
      const activation = createTemplateActivation({
        template: () => ({
          ...TEMPLATE,
          task: {
            steps: [
              {
                type: 'tool',
                tool: 'SetEntityProperty',
                arguments: {
                  entity_id: '{{trigger.entity_id}}',
                  entity_type: 'document',
                  property_definition_id: 'tags',
                  add_option_ids: ['authors-tag', 'team-tag'],
                },
              },
            ],
          },
          variables: [],
        }),
        activator: () => ACTIVATOR,
        access: () => new Map(),
        tags,
      });
      // Until the activator's tags load, there's nothing to activate.
      expect(activation.request()).toBeUndefined();
      setTags(new Set(['team-tag']));
      expect(activation.missingTags()).toEqual(['authors-tag']);
      const body = activation.request();
      expect(body?.enabled).toBe(false);
      expect(body?.task).toMatchObject({
        steps: [{ arguments: { add_option_ids: ['team-tag'] } }],
      });
      dispose();
    });
  });

  it('fills mentions in a tool step’s text the way its variable says', () => {
    createRoot((dispose) => {
      const author =
        '<m-user-mention>{"userId":"macro|eric@macro.com","email":"eric@macro.com"}</m-user-mention>';
      const activate = (fill: 'activator' | 'shared') =>
        createTemplateActivation({
          template: () => ({
            ...TEMPLATE,
            trigger: {
              type: 'events',
              filters: [{ events: ['task.created'] }],
            },
            task: {
              steps: [
                {
                  type: 'tool',
                  tool: 'SendChannelMessage',
                  arguments: {
                    channel_id: 'channel-1',
                    content: `New task for ${author}`,
                  },
                },
              ],
            },
            variables: [
              {
                kind: 'user',
                id: 'macro|eric@macro.com',
                label: 'eric@macro.com',
                fill,
              },
            ],
          }),
          activator: () => ACTIVATOR,
          access: () => new Map([['channel-1', true]]),
        });
      const filled = JSON.stringify(activate('activator').request()?.task);
      expect(filled).not.toContain('eric@macro.com');
      expect(filled).toContain('jun@macro.com');
      // "Same for everyone" keeps the author.
      const kept = JSON.stringify(activate('shared').request()?.task);
      expect(kept).toContain('eric@macro.com');
      expect(kept).not.toContain('jun@macro.com');
      dispose();
    });
  });

  it('fills the author in as the activator in every agent, branches included', () => {
    createRoot((dispose) => {
      const author =
        '<m-user-mention>{"userId":"macro|eric@macro.com","email":"eric@macro.com"}</m-user-mention>';
      const agent = (instructions: string) => ({
        type: 'agent',
        model: 'model',
        instructions,
      });
      const activation = createTemplateActivation({
        template: () => ({
          ...TEMPLATE,
          task: {
            steps: [
              {
                type: 'if',
                condition: 'Is it urgent?',
                // biome-ignore lint/suspicious/noThenProperty: the scheduler's step format names the yes branch `then`.
                then: [agent(`Page ${author}`)],
                else: [agent(`Tell ${author} tomorrow`)],
              },
            ],
          },
          variables: [
            {
              kind: 'user',
              id: 'macro|eric@macro.com',
              label: 'eric@macro.com',
              fill: 'activator',
            },
          ],
        }),
        activator: () => ACTIVATOR,
        access: () => new Map(),
      });
      const text = JSON.stringify(activation.request()?.task);
      expect(text).not.toContain('eric@macro.com');
      expect(text.match(/jun@macro\.com/g)).toHaveLength(4);
      dispose();
    });
  });
});
