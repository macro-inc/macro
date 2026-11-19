/** Canonical selector definitions are editable JSON, not expanded identities. */
export type EmailRuleSet = {
  schema_version: number;
  include: (
    | { kind: 'thread'; thread_id: string }
    | { kind: 'address'; address: string }
    | { kind: 'contact'; contact_id: string }
    | { kind: 'domain'; domain: string }
    | { kind: 'company'; company_id: string }
  )[];
};

/** An observed decision, never an authorization credential or refresh token. */
export type EmailPolicyToken =
  | { kind: 'legacy'; fingerprint: string }
  | {
      kind: 'policy';
      authority_fingerprint: string;
      consent_incarnation: string;
      policy_version: number;
    };

export type EmailPolicyView = {
  authoring_available: boolean;
  enabled: boolean;
  mode: 'all' | 'selected';
  effect: string;
  link_id?: string | null;
  mailbox_email?: string | null;
  revision?: number | null;
  rules?: EmailRuleSet | null;
  token?: EmailPolicyToken | null;
};

export type EmailPolicyCommand = {
  change:
    | { action: 'replace_rules'; rules: EmailRuleSet }
    | { action: 'enable_all' }
    | { action: 'withdraw' };
  if_policy: EmailPolicyToken;
  request_id: string;
};

export type EmailPolicyOutcome = {
  audit_event_id: string;
  effect: string;
  enabled: boolean;
  mode: 'all' | 'selected';
  replayed: boolean;
  revision?: number | null;
  token: EmailPolicyToken;
};

export type EmailRuleValidation = {
  rules: EmailRuleSet;
  effect: string;
  broad_rule_indices: number[];
  inactive_rule_indices: number[];
};

export type EmailPolicyAudit = {
  created_at: string;
  link_id: string;
  policy_version: number;
  consent_incarnation?: string | null;
  entry: {
    action:
      | 'rules_activated'
      | 'all_mail_enabled'
      | 'withdrawn'
      | 'mailbox_revoked'
      | 'live_targets_changed';
    actor_kind: 'member' | 'agent' | 'api' | 'system';
    event_id: string;
    agent_id?: string | null;
    agent_session_id?: string | null;
    next_revision?: number | null;
    previous_revision?: number | null;
    details: unknown;
  };
};

export type EmailPolicyHistory = {
  events: EmailPolicyAudit[];
  next_cursor?: string | null;
};

export type EmailPolicyRevision = {
  revision: number;
  created_at: string;
  link_id: string;
  rules: EmailRuleSet;
};

export type EmailPreviewRequest = {
  if_policy: EmailPolicyToken;
  if_preview_id?: string | null;
  rules: EmailRuleSet;
};

export type EmailPreviewView = {
  preview_id: string;
  context_id: string;
  created_at: string;
  expires_at: string;
  as_of?: string | null;
  scanned_threads: number;
  status:
    | 'pending'
    | 'running'
    | 'complete'
    | 'partial'
    | 'cancelled'
    | 'stale';
  counts: {
    current?: number;
    proposed?: number;
    added?: number;
    removed?: number;
    retained?: number;
    denied?: number;
  };
};
