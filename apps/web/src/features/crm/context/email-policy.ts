import type { ResultError } from '@core/util/result';
import type { Result } from 'neverthrow';
import type { Accessor } from 'solid-js';
import type {
  EmailPolicyAudit,
  EmailPolicyCommand,
  EmailPolicyHistory,
  EmailPolicyOutcome,
  EmailPolicyRevision,
  EmailPolicyToken,
  EmailPolicyView,
  EmailPreviewRequest,
  EmailPreviewView,
  EmailRuleSet,
  EmailRuleValidation,
} from '../core/email-policy';
import type { CrmQuery } from './crm-sources';

export type {
  EmailPolicyAudit,
  EmailPolicyCommand,
  EmailPolicyHistory,
  EmailPolicyOutcome,
  EmailPolicyRevision,
  EmailPolicyToken,
  EmailPolicyView,
  EmailPreviewView,
  EmailRuleSet,
  EmailRuleValidation,
};

export type EmailPolicyResult<T> = Promise<Result<T, ResultError[]>>;

/** Owner-scoped capabilities; reads never initialize consent. */
export type EmailPolicySource = {
  scope: Accessor<string | undefined>;
  query: CrmQuery<EmailPolicyView>;
  createRuleName(
    rule: EmailRuleSet['include'][number]
  ): Accessor<string | undefined>;
  createPreview(active: Accessor<boolean>): CrmQuery<EmailPreviewView | null>;
  read(): EmailPolicyResult<EmailPolicyView>;
  validate(json: string): EmailPolicyResult<EmailRuleValidation>;
  change(command: EmailPolicyCommand): EmailPolicyResult<EmailPolicyOutcome>;
  preview(): EmailPolicyResult<EmailPreviewView | null>;
  startPreview(input: EmailPreviewRequest): EmailPolicyResult<EmailPreviewView>;
  cancelPreview(id: string): EmailPolicyResult<void>;
  history(before?: string): EmailPolicyResult<EmailPolicyHistory>;
  revision(revision: number): EmailPolicyResult<EmailPolicyRevision | null>;
};
