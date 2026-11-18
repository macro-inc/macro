import type {
  EmailInclusionRule,
  EmailRuleSet,
} from '../../../generated/storage/types.gen';
import { MacroError } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { rejectUnknownOptions } from '../../utils/options';
import { Company } from '../crm/company';
import { Contact } from '../crm/contact';
import { EmailThread } from '../email/thread';

/** One positive whole-thread selector; existing exclusions always win. */
export type CrmEmailRule =
  | Extract<EmailInclusionRule, { kind: 'address' | 'domain' }>
  | {
      /** Select one mailbox-local thread owned by the caller. */
      kind: 'thread';
      thread: EmailThread;
    }
  | {
      /** Follow all current addresses on this visible contact. */
      kind: 'contact';
      contact: Contact;
    }
  | {
      /** Follow the company's current domains and visible contacts. */
      kind: 'company';
      company: Company;
    };

/** A complete replacement; an empty include list selects no mail. */
export type CrmEmailRuleSet = {
  /** Rule format version, currently 1; unrelated to policy revisions. */
  schemaVersion: EmailRuleSet['schema_version'];
  /** OR-combined selectors; contact and company targets resolve live. */
  include: CrmEmailRule[];
};

/** @internal Convert SDK handles without silently discarding mistyped options. */
export function emailRulesBody(rules: CrmEmailRuleSet): EmailRuleSet {
  rejectUnknownOptions('email privacy rules', rules, {
    schemaVersion: true,
    include: true,
  });

  return {
    schema_version: rules.schemaVersion,
    include: rules.include.map((rule): EmailInclusionRule => {
      switch (rule.kind) {
        case 'thread':
          rejectUnknownOptions('thread rule', rule, {
            kind: true,
            thread: true,
          });
          return { kind: rule.kind, thread_id: rule.thread.id };
        case 'contact':
          rejectUnknownOptions('contact rule', rule, {
            kind: true,
            contact: true,
          });
          return { kind: rule.kind, contact_id: rule.contact.id };
        case 'company':
          rejectUnknownOptions('company rule', rule, {
            kind: true,
            company: true,
          });
          return { kind: rule.kind, company_id: rule.company.id };
        case 'address':
          rejectUnknownOptions('address rule', rule, {
            kind: true,
            address: true,
          });
          return { kind: rule.kind, address: rule.address };
        case 'domain':
          rejectUnknownOptions('domain rule', rule, {
            kind: true,
            domain: true,
          });
          return { kind: rule.kind, domain: rule.domain };
        default:
          throw new MacroError('Unknown email inclusion rule kind.');
      }
    }),
  };
}

/** @internal Rebuild handles without fetching target details or email content. */
export function emailRules(
  client: MacroClient,
  rules: EmailRuleSet,
): CrmEmailRuleSet {
  return {
    schemaVersion: rules.schema_version,
    include: rules.include.map((rule): CrmEmailRule => {
      switch (rule.kind) {
        case 'thread':
          return {
            kind: rule.kind,
            thread: EmailThread.byId(client, rule.thread_id),
          };
        case 'contact':
          return {
            kind: rule.kind,
            contact: Contact.byId(client, rule.contact_id),
          };
        case 'company':
          return {
            kind: rule.kind,
            company: Company.byId(client, rule.company_id),
          };
        case 'address':
        case 'domain':
          return rule;
        default:
          throw new MacroError('Unknown email inclusion rule kind.');
      }
    }),
  };
}
