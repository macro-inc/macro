import type { GetContactResponses } from '../../../generated/storage/types.gen';
import type { RichMessage } from '../../mentions';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { FavoritableEntity } from '../entity';
import {
  DiscussionComment,
  type DiscussionParent,
  type DiscussionThread,
  listDiscussionThreads,
  postDiscussionComment,
} from '../messages/discussion';
import {
  MessageThread,
  type TimelineOptions,
  timeline,
} from '../messages/thread';
import { Company } from './company';

type ContactDetail = GetContactResponses[200];

/** A CRM contact: a person observed interacting with the team. */
export class Contact extends FavoritableEntity<ContactDetail> {
  /**
   * A shared message thread scoped to this resource.
   *
   * @readonly
   */
  messageThreadById(id: string): MessageThread {
    return MessageThread.byId(
      this.client,
      { type: 'crm_contact', entity: this },
      id,
    );
  }

  /**
   * A mixed message and activity timeline page.
   *
   * @readonly
   */
  timelinePage(selection?: TimelineOptions<DiscussionComment>) {
    return timeline(
      this.client,
      { type: 'crm_contact', entity: this },
      (record) =>
        DiscussionComment.from(
          this.client,
          { type: 'crm_contact', id: this.id },
          record,
        ),
      selection,
    );
  }

  /** Favorites identify CRM contacts as `crm_contact`. */
  readonly entityType = 'crm_contact';

  protected async fetch(): Promise<ContactDetail> {
    return unwrap(
      await this.client.storage.getContact({
        path: { contact_id: this.id },
      }),
    );
  }

  /** A handle to a CRM contact by id. Details load on first access. */
  static byId(client: MacroClient, id: string): Contact {
    return new Contact(client, id);
  }

  /** Build a contact from an API record (pre-seeded, no fetch). */
  static from(client: MacroClient, data: ContactDetail): Contact {
    return new Contact(client, data.id, data);
  }

  /** The contact's display name, if one has been observed. */
  readonly name = this.field('name');

  /** The contact's primary email address; absent for a contact added by name alone. */
  readonly email = this.field('email');

  /** Every address the contact is known by: the primary first, then the rest oldest first. */
  readonly emails = this.mappedField('emails', (emails) => emails ?? []);

  /**
   * Whether the contact has an address on one of its company's domains. Such a
   * contact cannot be unlinked from the company or moved to another.
   */
  readonly companyDomain = this.mappedField(
    'companyDomain',
    (companyDomain) => companyDomain ?? false,
  );

  /**
   * The addresses on one of the company's domains. The last one cannot be
   * removed while the contact is linked to the company.
   */
  readonly companyDomainEmails = this.mappedField(
    'companyDomainEmails',
    (emails) => emails ?? [],
  );

  /** The CRM company this contact belongs to, if it has one. */
  readonly company = this.mappedField('companyId', (id) =>
    id ? Company.byId(this.client, id) : undefined,
  );

  /** Whether the contact is hidden from CRM listings. */
  readonly hidden = this.field('hidden');

  /** When the contact was first created in the CRM. */
  readonly createdAt = this.field('createdAt');

  /** When the contact was last updated. */
  readonly updatedAt = this.field('updatedAt');

  /** When the team first interacted with this contact. */
  readonly firstInteraction = this.field('firstInteraction');

  /** When the team last interacted with this contact. */
  readonly lastInteraction = this.field('lastInteraction');

  /**
   * Hide the contact from CRM listings. Display-only; reversible with {@link unhide}.
   *
   * @write
   * @idempotent
   */
  async hide(): Promise<void> {
    await this.setHidden(true);
  }

  /**
   * Un-hide the contact, restoring it to CRM listings.
   *
   * @write
   * @idempotent
   */
  async unhide(): Promise<void> {
    await this.setHidden(false);
  }

  private async setHidden(hidden: boolean): Promise<void> {
    await this.mutate((c) =>
      c.storage.setContactHidden({
        path: { contact_id: this.id },
        body: { hidden },
      }),
    );
  }

  /**
   * Rename the contact for the caller's current team.
   *
   * @write
   * @idempotent
   */
  async rename(name: string): Promise<void> {
    await this.mutate((c) =>
      c.storage.setCrmContactName({
        path: { contact_id: this.id },
        body: { name },
      }),
    );
  }

  /**
   * Make an address the contact's primary, adding it when the contact does not
   * hold it yet. The previous primary stays on the contact.
   *
   * @write
   * @idempotent
   */
  async setEmail(email: string): Promise<void> {
    await this.mutate((c) =>
      c.storage.setCrmContactEmail({
        path: { contact_id: this.id },
        body: { email },
      }),
    );
  }

  /**
   * Add a further address the contact is known by. It must not belong to
   * another contact in the team, and becomes the primary only when the contact
   * has none.
   *
   * @write
   * @idempotent
   */
  async addEmail(email: string): Promise<void> {
    await this.mutate((c) =>
      c.storage.addCrmContactEmail({
        path: { contact_id: this.id },
        body: { email },
      }),
    );
  }

  /**
   * Remove one of the contact's addresses. Nothing else is deleted: the contact
   * stops showing that address's email history. Removing the primary promotes
   * the oldest address left. The last address on a domain of the contact's
   * company cannot be removed while the contact is linked to it.
   *
   * @destructive
   * @idempotent
   */
  async removeEmail(email: string): Promise<void> {
    await this.mutate((c) =>
      c.storage.removeCrmContactEmail({
        path: { contact_id: this.id },
        body: { email },
      }),
    );
  }

  /**
   * Link or switch the company of a contact whose primary address is on a
   * personal provider. Rejected for a contact on its company's domain.
   *
   * @write
   * @idempotent
   */
  async setCompany(company: Company): Promise<void> {
    await this.mutate((c) =>
      c.storage.setCrmContactCompany({
        path: { contact_id: this.id },
        body: { companyId: company.id },
      }),
    );
  }

  /**
   * Remove the contact's company link, leaving a contact without a company.
   * Rejected for a contact on its company's domain.
   *
   * @write
   * @idempotent
   */
  async unlinkCompany(): Promise<void> {
    await this.mutate((c) =>
      c.storage.unlinkCrmContactCompany({
        path: { contact_id: this.id },
      }),
    );
  }

  /** The CRM record this contact's discussions hang off. */
  private get commentParent(): DiscussionParent {
    return { type: 'crm_contact', id: this.id };
  }

  /**
   * The comment threads on this contact, newest thread first.
   *
   * @readonly
   */
  async comments(): Promise<DiscussionThread[]> {
    return listDiscussionThreads(this.client, this.commentParent);
  }

  /**
   * Add a comment. Starts a new thread, or replies to an existing one when
   * `threadId` (the thread's root comment id) is given.
   *
   * @param body - Plain text, or a rich body composed with {@link msg}.
   *
   * @write
   */
  async comment(
    body: string | RichMessage,
    opts?: { threadId?: string },
  ): Promise<DiscussionComment> {
    return postDiscussionComment(this.client, this.commentParent, body, opts);
  }

  /**
   * A handle to one of this contact's comments by id.
   *
   * @readonly
   */
  commentById(id: string): DiscussionComment {
    return DiscussionComment.byId(this.client, this.commentParent, id);
  }
}
