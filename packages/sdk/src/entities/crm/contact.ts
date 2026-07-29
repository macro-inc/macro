import type {
  CreateCrmCommentRequest,
  DeleteCrmCommentResult,
  GetContactResponses,
} from '../../../generated/storage/types.gen';
import { MacroError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { FavoritableEntity } from '../entity';
import { CrmComment, type CrmThreadWithComments } from './comment';
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

  /** The comment threads attached to this contact, with comments oldest first. */
  async comments(): Promise<CrmThreadWithComments[]> {
    const threads = unwrap(
      await this.client.storage.listCrmComments({
        path: { entity_type: 'crm_contact', entity_id: this.id },
      }),
    );
    return threads.map(({ thread, comments }) => ({
      thread,
      comments: comments.map((c) => CrmComment.from(this.client, c)),
    }));
  }

  /** Add a comment: starts a new thread unless `body.threadId` targets an existing one. */
  async comment(body: CreateCrmCommentRequest): Promise<CrmComment> {
    const { comments } = await this.mutate((c) =>
      c.storage.createCrmComment({
        path: { entity_type: 'crm_contact', entity_id: this.id },
        body,
      }),
    );
    const created = comments.reduce<(typeof comments)[number] | undefined>(
      (a, b) => (!a || b.createdAt > a.createdAt ? b : a),
      undefined,
    );
    if (!created)
      throw new MacroError('create comment returned an empty thread');
    return CrmComment.from(this.client, created);
  }

  /** Replace a comment's text (markdown). */
  async editComment(comment: CrmComment, text: string): Promise<CrmComment> {
    const record = await this.mutate((c) =>
      c.storage.editCrmComment({
        path: { comment_id: comment.id },
        body: { text },
      }),
    );
    return CrmComment.from(this.client, record);
  }

  /** Soft-delete a comment; the thread goes too when it was the last live one. */
  async deleteComment(comment: CrmComment): Promise<DeleteCrmCommentResult> {
    return this.mutate((c) =>
      c.storage.deleteCrmComment({ path: { comment_id: comment.id } }),
    );
  }
}
