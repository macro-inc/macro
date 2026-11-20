import type { EmailPolicyRevision } from '../../../generated/storage/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Link } from '../email/link';
import { MacroEntity } from '../entity';
import { type CrmEmailRuleSet, emailRules } from './email-rules';

/** One immutable rule definition in the caller's current team's history. */
export type CrmEmailRuleDefinition = {
  /** The mailbox this definition was saved for. */
  inbox: Link;
  /** Definition commit time, as an RFC 3339 timestamp. */
  createdAt: string;
  /** Stored selectors, not an expansion of their live targets. */
  rules: CrmEmailRuleSet;
};

/** A saved definition; reading it never reapplies it or grants access to its targets. */
export class CrmEmailRuleRevision extends MacroEntity<CrmEmailRuleDefinition> {
  private constructor(
    client: MacroClient,
    private readonly revision: number,
  ) {
    super(client, String(revision));
  }

  /** Construct a definition handle from its revision number. */
  static byId(client: MacroClient, revision: number): CrmEmailRuleRevision {
    return new CrmEmailRuleRevision(client, revision);
  }

  protected async fetch(): Promise<CrmEmailRuleDefinition> {
    const record: EmailPolicyRevision | null = unwrap(
      await this.client.storage.getCrmEmailRuleRevision({
        path: { revision: this.revision },
      }),
    );
    if (!record)
      throw new MacroNotFoundError('Email rule revision is unavailable.');

    return {
      inbox: Link.byId(this.client, record.link_id),
      createdAt: record.created_at,
      rules: emailRules(this.client, record.rules),
    };
  }

  /**
   * Read this saved definition without fetching live contact, company or email content.
   *
   * @readonly
   */
  async get(): Promise<CrmEmailRuleDefinition> {
    return this.detail.get();
  }
}
