import type { GetContactResponses } from '../../../generated/storage/types.gen';
import type { RichMessage } from '../../mentions';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { FavoritableEntity } from '../entity';
import {
  CrmComment,
  type CrmCommentParent,
  type CrmCommentThread,
  listCrmCommentThreads,
  postCrmComment,
} from './comment';
import { Company } from './company';

type ContactDetail = GetContactResponses[200];

/** A CRM contact: a person observed interacting with the team. */
export class Contact extends FavoritableEntity<ContactDetail> {
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

  /** The contact's email address. */
  readonly email = this.field('email');

  /** The CRM company this contact belongs to. */
  readonly company = this.mappedField('companyId', (id) =>
    Company.byId(this.client, id),
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

  /** Hide the contact from CRM listings. Display-only; reversible with {@link unhide}. */
  async hide(): Promise<void> {
    await this.setHidden(true);
  }

  /** Un-hide the contact, restoring it to CRM listings. */
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

  /** Rename the contact for the caller's current team. */
  async rename(name: string): Promise<void> {
    await this.mutate((c) =>
      c.storage.setCrmContactName({
        path: { contact_id: this.id },
        body: { name },
      }),
    );
  }

  /** The CRM record this contact's discussions hang off. */
  private get commentParent(): CrmCommentParent {
    return { type: 'crm_contact', id: this.id };
  }

  /** The comment threads on this contact, newest thread first. */
  async comments(): Promise<CrmCommentThread[]> {
    return listCrmCommentThreads(this.client, this.commentParent);
  }

  /**
   * Add a comment. Starts a new thread, or replies to an existing one when
   * `threadId` (the thread's root comment id) is given.
   *
   * @param body - Plain text, or a rich body composed with {@link msg}.
   */
  async comment(
    body: string | RichMessage,
    opts?: { threadId?: string },
  ): Promise<CrmComment> {
    return postCrmComment(this.client, this.commentParent, body, opts);
  }

  /** A handle to one of this contact's comments by id. */
  commentById(id: string): CrmComment {
    return CrmComment.byId(this.client, this.commentParent, id);
  }
}
