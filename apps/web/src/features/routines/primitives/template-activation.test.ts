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
});
