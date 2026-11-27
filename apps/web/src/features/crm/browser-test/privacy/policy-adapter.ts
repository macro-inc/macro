import { deepEqual } from '@core/util/compareUtils';
import type { crmEmailPolicyClient } from '@service-storage/crm-email-policy';
import { err, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import type {
  EmailPolicyAudit,
  EmailPolicyView,
  EmailPreviewView,
  EmailRuleSet,
} from '../../context/email-policy';

const params = new URLSearchParams(location.search);
const pendingPolicyRead = Promise.withResolvers<void>();
export const finishPolicyRead = () => pendingPolicyRead.resolve();
const mailbox = '00000000-0000-4000-8000-000000000045';
const timestamp = '2026-01-01T09:42:00Z';
export const fixtureRules: EmailRuleSet = {
  schema_version: 1,
  include: [
    { kind: 'domain', domain: 'partner.example.com' },
    { kind: 'address', address: 'contact@example.net' },
    { kind: 'contact', contact_id: '00000000-0000-4000-8000-000000000021' },
    { kind: 'company', company_id: '00000000-0000-4000-8000-000000000022' },
    { kind: 'thread', thread_id: '00000000-0000-4000-8000-000000000046' },
  ],
};
let view: EmailPolicyView = {
  authoring_available: !params.has('policy-gate-off'),
  enabled: params.has('contributing'),
  mode:
    params.has('all-mail') || !params.has('selective-settings')
      ? 'all'
      : 'selected',
  token: { kind: 'legacy', fingerprint: 'observed' },
  revision: 1,
  rules: params.has('all-mail') ? null : fixtureRules,
  effect: '',
  link_id: params.has('disconnected') ? null : mailbox,
  mailbox_email: params.has('disconnected') ? null : 'member@example.com',
};
export function connectPolicyMailbox() {
  view = { ...view, link_id: mailbox, mailbox_email: 'member@example.com' };
}
export const [policyCalls, setPolicyCalls] = createSignal<string[]>([]);
function record(call: string) {
  setPolicyCalls((calls) => [...calls, call]);
}
let conflicted = false;
let preview: EmailPreviewView | null = null;
const events: EmailPolicyAudit[] = [
  {
    created_at: timestamp,
    link_id: mailbox,
    policy_version: 1,
    entry: {
      event_id: '00000000-0000-4000-8000-000000000031',
      actor_kind: 'agent',
      action: 'rules_activated',
      next_revision: 1,
      details: {},
    },
  },
  {
    created_at: '2026-01-01T08:30:00Z',
    link_id: mailbox,
    policy_version: 0,
    entry: {
      event_id: '00000000-0000-4000-8000-000000000030',
      actor_kind: 'member',
      action: 'all_mail_enabled',
      details: {},
    },
  },
];
export const policyClient = {
  get: async () => {
    record('get');
    if (params.has('policy-pending')) await pendingPolicyRead.promise;
    if (params.has('policy-unavailable'))
      return err([
        { code: 'HTTP_ERROR' as const, message: 'Policy unavailable.' },
      ]);
    return ok(view);
  },
  validate: async (json: string) => {
    record('validate');
    if (params.has('limit'))
      return err([
        {
          code: 'HTTP_ERROR' as const,
          message: 'Rule discovery limit exceeded: 2000 addresses.',
        },
      ]);
    const rules: EmailRuleSet = JSON.parse(json);
    return ok({
      rules,
      broad_rule_indices: [0],
      inactive_rule_indices: [],
      effect: '',
    });
  },
  replace: async (command) => {
    record('replace');
    if (params.has('conflict') && !conflicted) {
      conflicted = true;
      view = { ...view, token: { kind: 'legacy', fingerprint: 'changed' } };
    }
    if (!deepEqual(command.if_policy, view.token)) {
      return err([
        {
          code: 'CONFLICT' as const,
          message:
            'email contribution changed; inspect the current policy before retrying',
        },
      ]);
    }
    view = {
      ...view,
      token: { kind: 'legacy', fingerprint: 'saved' },
      enabled: command.change.action !== 'withdraw',
      mode: command.change.action === 'enable_all' ? 'all' : 'selected',
      rules:
        command.change.action === 'replace_rules'
          ? command.change.rules
          : view.rules,
      revision: 2,
    };
    events.unshift({
      created_at: timestamp,
      link_id: mailbox,
      policy_version: 2,
      entry: {
        event_id: '00000000-0000-4000-8000-000000000032',
        actor_kind: 'member',
        action: 'rules_activated',
        next_revision: 2,
        details: {},
      },
    });
    return ok({
      audit_event_id: 'event',
      token: { kind: 'legacy', fingerprint: 'saved' },
      enabled: view.enabled,
      mode: view.mode,
      revision: view.revision,
      effect: '',
      replayed: false,
    });
  },
  history: async () => {
    record('history');
    return ok({ events: [...events], next_cursor: null });
  },
  revision: async (revision: number) => {
    record('revision');
    return ok({
      revision,
      created_at: timestamp,
      link_id: mailbox,
      rules: fixtureRules,
    });
  },
  preview: async () => {
    record('preview');
    return ok(preview);
  },
  startPreview: async () => {
    record('start-preview');
    preview = {
      preview_id: '00000000-0000-4000-8000-000000000041',
      context_id: '00000000-0000-4000-8000-000000000042',
      created_at: timestamp,
      expires_at: timestamp,
      as_of: timestamp,
      scanned_threads: 2480,
      status: params.has('partial') ? 'partial' : 'complete',
      counts: {
        current: 186,
        proposed: 214,
        added: 36,
        removed: 8,
        retained: 178,
        denied: 12,
      },
    };
    return ok(preview);
  },
  cancelPreview: async () => {
    record('cancel-preview');
    preview = null;
    return ok(undefined);
  },
} satisfies typeof crmEmailPolicyClient;
