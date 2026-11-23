import type {
  EmailPolicyAudit,
  EmailPolicyChange,
  EmailPolicyCommand,
  EmailPolicyOutcome,
  EmailPolicyToken,
  EmailPolicyView,
  EmailPrivacyChange,
  EmailPrivacySettings,
  EmailRuleValidation,
} from '../../../generated/storage/types.gen';
import { MacroError, paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { rejectUnknownOptions } from '../../utils/options';
import { type IterationOptions, iterate } from '../../utils/pagination';
import { AgentSession } from '../agent-sessions/agent-session';
import { Agent } from '../agents/agent';
import { Link } from '../email/link';
import { EmailThread } from '../email/thread';
import { CrmEmailRulePreview } from './email-rule-preview';
import { CrmEmailRuleRevision } from './email-rule-revision';
import {
  type CrmEmailRuleSet,
  emailRules,
  emailRulesBody,
} from './email-rules';

/** The server's opaque observation; pass it unchanged, never refresh on conflict. */
export type CrmEmailPolicyToken = EmailPolicyToken;

/** A retry repeats this exact observation, key and command. */
export type CrmEmailPolicyWriteOptions = {
  /** The token returned by the inspection on which this decision was based. */
  ifPolicy: CrmEmailPolicyToken;
  /** One UUID per intended operation, reused only for its exact retries. */
  idempotencyKey: EmailPolicyCommand['request_id'];
};

/** Inspection is read-only, including before a member ever contributes. */
export type CrmEmailPolicy = {
  /** False means rule authoring is unavailable; do not attempt to bypass the gate. */
  authoringAvailable: boolean;
  /** Server explanation of whole-thread sharing, live targets and exclusions. */
  effect: string;
  /** Whether this mailbox currently contributes. */
  enabled: boolean;
  /** Exact current or prospective primary mailbox. */
  inbox?: Link;
  /** Address displayed for that mailbox. */
  mailboxEmail?: string;
  /** All eligible mail or selected whole threads. */
  mode: EmailPolicyView['mode'];
  /** Active saved definition, when selected. */
  revision?: CrmEmailRuleRevision;
  /** Saved selectors; handles do not fetch live target details. */
  rules?: CrmEmailRuleSet;
  /** Absent for legacy state while authoring is off. */
  token?: CrmEmailPolicyToken;
};

/** A committed result; replayed describes the old commit, not current sharing. */
export type CrmEmailPolicyResult = {
  /** Correlation with the owner's audit history, not an authorization token. */
  auditEventId: EmailPolicyOutcome['audit_event_id'];
  effect: string;
  enabled: boolean;
  mode: EmailPolicyOutcome['mode'];
  replayed: boolean;
  revision?: CrmEmailRuleRevision;
  token: CrmEmailPolicyToken;
};

/** Canonical selectors and bounded warnings; no contribution is granted. */
export type CrmEmailRuleValidation = {
  rules: CrmEmailRuleSet;
  effect: string;
  /** Indices in the canonical rules that may match most of this mailbox. */
  broadRuleIndices: EmailRuleValidation['broad_rule_indices'];
  /** Canonical rules whose live targets currently match nothing. */
  inactiveRuleIndices: EmailRuleValidation['inactive_rule_indices'];
};

/** Actor provenance comes from authenticated credentials, never the SDK request. */
export type CrmEmailPolicyHistoryEvent = {
  /** Stable event correlation identity. */
  id: string;
  action: EmailPolicyAudit['entry']['action'];
  actorKind: EmailPolicyAudit['entry']['actor_kind'];
  agent?: Agent;
  agentSession?: AgentSession;
  createdAt: string;
  inbox: Link;
  /** Historical lifetime/version; neither grants permission to write. */
  consentIncarnation?: string;
  policyVersion: number;
  previousRevision?: CrmEmailRuleRevision;
  nextRevision?: CrmEmailRuleRevision;
  /** Bounded server metadata without mail content or expanded targets. */
  details: unknown;
};

/** Existing consent and exclusions; CRM viewing permission is not required. */
export type CrmEmailPrivacySettings = {
  enabled: boolean;
  inbox?: Link;
  mailboxEmail?: string;
  personalDomains: string[];
  teamDomains: string[];
  personalDomainWarnings: EmailPrivacySettings['personal_domain_warnings'];
  teamDomainWarnings: EmailPrivacySettings['team_domain_warnings'];
  canRemoveTeamDomains: boolean;
};

/** One private mailbox copy; another member's eligible copy remains visible. */
export type CrmExcludedEmailThread = {
  thread: EmailThread;
  inbox: Link;
  subject?: string;
};

/**
 * Own-member contribution rules and exclusions, independent of CRM viewing access.
 *
 * @routing Use when reading or changing which of your emails contribute to CRM; not inbox filters or another member's contribution.
 *
 * @agent
 * ## Email contribution
 *
 * `crm.emailPrivacy` manages only the authenticated member's contribution, even when CRM viewing is disabled. Read `get()` before deciding, and use its exact token plus one UUID idempotency key per intended write. A member-authorized agent activates rules directly; no separate member confirmation is required. A 409 requires inspection and a new decision, never an automatic token refresh and retry. Restricted credentials and server rollout gates still apply.
 *
 * Explain that a matching participant shares the whole past/future thread, contact/company targets resolve live, and all exclusions override inclusions. Narrowing or withdrawal hides this member's ineligible copies while CRM records remain; another member's independently eligible copy stays visible. `settings()` and `excludedThreads()` read existing exclusions separately. Preview counts are optional, mailbox-local and bounded: only complete is exact; partial is a lower bound and stale/cancelled is not a current estimate. Replayed mutations describe the original commit, so inspect again to report current sharing.
 */
export class CrmEmailPrivacyNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * Inspect your sharing and token without initializing consent; read exclusions separately with settings and excludedThreads.
   * Handles do not fetch CRM records or email content. With the gate off a legacy
   * member gets no editable token; existing consent withdrawal still uses setConsent(false).
   *
   * @readonly
   */
  async get(): Promise<CrmEmailPolicy> {
    const state = unwrap(await this.client.storage.getCrmEmailPolicy());
    return {
      authoringAvailable: state.authoring_available,
      effect: state.effect,
      enabled: state.enabled,
      inbox: state.link_id ? Link.byId(this.client, state.link_id) : undefined,
      mailboxEmail: state.mailbox_email ?? undefined,
      mode: state.mode,
      revision:
        state.revision == null
          ? undefined
          : CrmEmailRuleRevision.byId(this.client, state.revision),
      rules: state.rules ? emailRules(this.client, state.rules) : undefined,
      token: state.token ?? undefined,
    };
  }

  /**
   * Validate and normalize rules without sharing mail; warnings refer to the returned canonical list.
   * Contact/company targets resolve live; a hidden or deleted target may be inactive.
   * Validation is not a grant or capacity reservation. Activation repeats the same live-expansion
   * resource check; a named limit error leaves sharing unchanged. Server limits and field errors are preserved.
   *
   * @readonly
   */
  async validateRules(rules: CrmEmailRuleSet): Promise<CrmEmailRuleValidation> {
    const result = unwrap(
      await this.client.storage.validateCrmEmailRules({
        body: emailRulesBody(rules),
      }),
    );
    return {
      rules: emailRules(this.client, result.rules),
      effect: result.effect,
      broadRuleIndices: result.broad_rule_indices,
      inactiveRuleIndices: result.inactive_rule_indices,
    };
  }

  /**
   * Activate a complete replacement directly as the member; this shares eligible past and future whole threads.
   * One matching participant includes the whole thread. Contacts and companies
   * resolve live, while private threads and other exclusions always win. An empty
   * list selects nothing. Previously created CRM records remain after narrowing.
   * Ordinary member-authorized agents may activate without a separate human
   * confirmation; restricted credentials and rollout gates still apply.
   * Reuse the same key, token and rules only for an exact retry. On 409 inspect and
   * decide again; never refresh the token automatically or retry the old decision.
   * A named resource-limit error refuses this replacement without changing sharing.
   * Later live growth can exceed the same limits and fail Team email reads; withdrawal stays available.
   * A replayed result records the original commit, not current sharing.
   *
   * @destructive
   * @idempotent
   */
  async replaceRules(
    rules: CrmEmailRuleSet,
    options: CrmEmailPolicyWriteOptions,
  ): Promise<CrmEmailPolicyResult> {
    return this.changePolicy(
      { action: 'replace_rules', rules: emailRulesBody(rules) },
      options,
    );
  }

  /**
   * Share all eligible past and future mail using the observed token; exclusions still win and the rollout gate still applies.
   * This replaces selected scope. Never refresh a stale token or retry an old
   * decision after 409. Exact retries reuse the same idempotency key and token.
   *
   * @destructive
   * @idempotent
   */
  async enableAll(
    options: CrmEmailPolicyWriteOptions,
  ): Promise<CrmEmailPolicyResult> {
    return this.changePolicy({ action: 'enable_all' }, options);
  }

  /**
   * Withdraw your contribution using the observed token; CRM records and eligible teammate copies remain.
   * Modern withdrawal remains available when authoring is disabled. Legacy members
   * without a token use setConsent(false). No automatic token refresh or conflict retry.
   *
   * @destructive
   * @idempotent
   */
  async withdraw(
    options: CrmEmailPolicyWriteOptions,
  ): Promise<CrmEmailPolicyResult> {
    return this.changePolicy({ action: 'withdraw' }, options);
  }

  private async changePolicy(
    change: EmailPolicyChange,
    options: CrmEmailPolicyWriteOptions,
  ): Promise<CrmEmailPolicyResult> {
    rejectUnknownOptions('email privacy change', options, {
      ifPolicy: true,
      idempotencyKey: true,
    });
    const result = unwrap(
      await this.client.storage.updateCrmEmailPolicy({
        body: {
          change,
          if_policy: options.ifPolicy,
          request_id: options.idempotencyKey,
        },
      }),
    );
    return {
      auditEventId: result.audit_event_id,
      effect: result.effect,
      enabled: result.enabled,
      mode: result.mode,
      replayed: result.replayed,
      revision:
        result.revision == null
          ? undefined
          : CrmEmailRuleRevision.byId(this.client, result.revision),
      token: result.token,
    };
  }

  /**
   * Start a bounded count preview without activating consent; first inspect the current slot with preview().
   * Pass that exact handle as ifPreview, or omit it only when no preview exists.
   * The policy token must come from the decision's inspection. No automatic retry
   * on conflicts or throttling. Counts cover only your mailbox copies; only a
   * complete result is exact. Work is capped at 10,000 raw threads and five minutes.
   *
   * @readonly
   */
  async previewRules(
    rules: CrmEmailRuleSet,
    options: {
      ifPolicy: CrmEmailPolicyToken;
      ifPreview?: CrmEmailRulePreview;
    },
  ): Promise<CrmEmailRulePreview> {
    rejectUnknownOptions('email privacy preview', options, {
      ifPolicy: true,
      ifPreview: true,
    });
    return CrmEmailRulePreview.from(
      this.client,
      unwrap(
        await this.client.storage.previewCrmEmailRules({
          body: {
            rules: emailRulesBody(rules),
            if_policy: options.ifPolicy,
            if_preview_id: options.ifPreview?.id ?? null,
          },
        }),
      ),
    );
  }

  /**
   * Inspect the current preview slot without starting work; retain its handle before requesting replacement.
   *
   * @readonly
   */
  async preview(): Promise<CrmEmailRulePreview | undefined> {
    const record = unwrap(await this.client.storage.getCrmEmailRulePreview());
    return record ? CrmEmailRulePreview.from(this.client, record) : undefined;
  }

  /**
   * Iterate your audit history lazily, fifty events per page; `maxItems` caps the total. Definitions are separate revision handles.
   * Agent and session handles identify verified provenance and never fetch their content automatically.
   *
   * @readonly
   */
  history(opts?: IterationOptions): AsyncGenerator<CrmEmailPolicyHistoryEvent> {
    return iterate('crm.emailPrivacy.history', opts, {}, () =>
      this.historyEvents(),
    );
  }

  private historyEvents(): AsyncGenerator<CrmEmailPolicyHistoryEvent> {
    return paginate(async (before) => {
      const page = unwrap(
        await this.client.storage.listCrmEmailPolicyHistory({
          query: { before },
        }),
      );
      return {
        nextCursor: page.next_cursor,
        items: page.events.map(
          (event): CrmEmailPolicyHistoryEvent => ({
            id: event.entry.event_id,
            action: event.entry.action,
            actorKind: event.entry.actor_kind,
            agent: event.entry.agent_id
              ? Agent.byId(this.client, event.entry.agent_id)
              : undefined,
            agentSession: event.entry.agent_session_id
              ? AgentSession.byId(this.client, event.entry.agent_session_id)
              : undefined,
            createdAt: event.created_at,
            inbox: Link.byId(this.client, event.link_id),
            consentIncarnation: event.consent_incarnation ?? undefined,
            policyVersion: event.policy_version,
            previousRevision:
              event.entry.previous_revision == null
                ? undefined
                : CrmEmailRuleRevision.byId(
                    this.client,
                    event.entry.previous_revision,
                  ),
            nextRevision:
              event.entry.next_revision == null
                ? undefined
                : CrmEmailRuleRevision.byId(
                    this.client,
                    event.entry.next_revision,
                  ),
            details: event.entry.details,
          }),
        ),
      };
    });
  }

  /**
   * Read current mailbox consent and personal/team domain exclusions without changing sharing.
   * Use get() for selected rules and their token, and excludedThreads() for private exceptions.
   *
   * @readonly
   */
  async settings(): Promise<CrmEmailPrivacySettings> {
    const settings = unwrap(await this.client.storage.getCrmEmailPrivacy());
    if (!('personal_domains' in settings))
      throw new MacroError('Expected full CRM email privacy settings.');
    return this.privacySettings(settings);
  }

  /**
   * Change existing all-mail consent; policies with a token use enableAll or withdraw instead.
   * Enabling requires the exact primary inbox the member chose, and shares all
   * eligible past and future mail. Disabling needs no connected inbox. This
   * existing API never activates selected rules or bypasses their rollout gate.
   *
   * @destructive
   * @idempotent
   */
  async setConsent(
    enabled: boolean,
    inbox?: Link,
  ): Promise<CrmEmailPrivacySettings> {
    if (enabled && !inbox)
      throw new MacroError(
        'Choose the primary inbox before enabling contribution.',
      );
    return this.changePrivacy({
      action: 'set_consent',
      enabled,
      link_id: inbox?.id,
    });
  }

  /**
   * Exclude a domain from your contributions retroactively; existing CRM records remain.
   * Team-wide domain controls remain on crm.blockDomain/unblockDomain.
   *
   * @destructive
   * @idempotent
   */
  async blockDomain(domain: string): Promise<CrmEmailPrivacySettings> {
    return this.changePrivacy({
      action: 'add_domain',
      scope: 'personal',
      domain,
    });
  }

  /**
   * Remove your domain exclusion; consent, selected rules and all other exclusions still apply.
   *
   * @write
   * @idempotent
   */
  async unblockDomain(domain: string): Promise<CrmEmailPrivacySettings> {
    return this.changePrivacy({
      action: 'remove_domain',
      scope: 'personal',
      domain,
    });
  }

  /**
   * Set or clear your private thread exception; another member's eligible copy is unaffected.
   * Only your mailbox-local thread may be changed. Clearing does not itself opt
   * anything in. The existing thread-exclusion rollout gate remains enforced.
   *
   * @destructive
   * @idempotent
   */
  async setThreadExcluded(
    thread: EmailThread,
    excluded: boolean,
  ): Promise<CrmEmailPrivacySettings> {
    return this.changePrivacy({
      action: 'set_thread_exclusion',
      thread_id: thread.id,
      excluded,
    });
  }

  /**
   * Iterate only your private thread exceptions lazily; `maxItems` caps the total. Subjects come from your own mailbox.
   *
   * @readonly
   */
  excludedThreads(
    opts?: IterationOptions,
  ): AsyncGenerator<CrmExcludedEmailThread> {
    return iterate('crm.emailPrivacy.excludedThreads', opts, {}, () =>
      this.excludedThreadPages(),
    );
  }

  private excludedThreadPages(): AsyncGenerator<CrmExcludedEmailThread> {
    return paginate(async (after) => {
      const page = unwrap(
        await this.client.storage.listCrmExcludedEmailThreads({
          query: { after },
        }),
      );
      return {
        nextCursor: page.next_cursor,
        items: page.threads.map((entry) => ({
          thread: EmailThread.byId(this.client, entry.thread_id),
          inbox: Link.byId(this.client, entry.link_id),
          subject: entry.subject ?? undefined,
        })),
      };
    });
  }

  private async changePrivacy(
    change: EmailPrivacyChange,
  ): Promise<CrmEmailPrivacySettings> {
    return this.privacySettings(
      unwrap(await this.client.storage.updateCrmEmailPrivacy({ body: change })),
    );
  }

  private privacySettings(
    settings: EmailPrivacySettings,
  ): CrmEmailPrivacySettings {
    return {
      enabled: settings.enabled,
      inbox: settings.mailbox_link_id
        ? Link.byId(this.client, settings.mailbox_link_id)
        : undefined,
      mailboxEmail: settings.mailbox_email ?? undefined,
      personalDomains: settings.personal_domains,
      teamDomains: settings.team_domains,
      personalDomainWarnings: settings.personal_domain_warnings,
      teamDomainWarnings: settings.team_domain_warnings,
      canRemoveTeamDomains: settings.can_remove_team_domains,
    };
  }
}
