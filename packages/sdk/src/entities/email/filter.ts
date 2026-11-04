import type { ApiEmailFilter } from '../../../generated/email/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { Link } from './link';

/** Sender importance rule. */
export interface EmailFilterOptions {
  /** Match an address. */
  emailAddress?: string;
  /** Match a domain. */
  emailDomain?: string;
  /** Whether matches are important. */
  isImportant: boolean;
}

/** An importance filter matched by sender address or domain. */
export class EmailFilter extends MacroEntity<ApiEmailFilter> {
  private constructor(
    client: MacroClient,
    id: string,
    seed?: ApiEmailFilter,
    private readonly inbox?: Link,
  ) {
    super(client, id, seed);
  }

  private get headers() {
    return this.inbox ? { 'X-Email-Link-Id': this.inbox.id } : undefined;
  }

  /** Construct a lazy filter handle. */
  static byId(client: MacroClient, id: string, inbox?: Link): EmailFilter {
    return new EmailFilter(client, id, undefined, inbox);
  }

  /** Seed from a server record. */
  static from(
    client: MacroClient,
    record: ApiEmailFilter,
    inbox?: Link,
  ): EmailFilter {
    return new EmailFilter(client, record.id, record, inbox);
  }

  protected async fetch(): Promise<ApiEmailFilter> {
    const record = unwrap(
      await this.client.email.listEmailFilters({ headers: this.headers }),
    ).filters.find((f) => f.id === this.id);
    if (!record)
      throw new MacroNotFoundError(`Email filter ${this.id} is unavailable`);
    return record;
  }

  /** Matched address. */
  readonly emailAddress = this.field('email_address');

  /** Matched domain. */
  readonly emailDomain = this.field('email_domain');

  /** Importance assigned by this filter. */
  readonly isImportant = this.field('is_important');

  /** Change the importance for the same sender selector. */
  async setImportant(isImportant: boolean): Promise<void> {
    const record = await this.detail.get();
    await this.mutate((c) =>
      c.email.upsertEmailFilter({
        headers: this.headers,
        body: {
          email_address: record.email_address,
          email_domain: record.email_domain,
          is_important: isImportant,
        },
      }),
    );
  }

  /** Delete this filter. */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.email.deleteEmailFilter({
        path: { id: this.id },
        headers: this.headers,
      }),
    );
  }
}
