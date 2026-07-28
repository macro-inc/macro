import type {
  CreateCrmCommentRequest,
  DeleteCrmCommentResult,
  GetCompanyResponses,
} from '../../../generated/storage/types.gen';
import { MacroError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { PropertiedEntity } from '../entity';
import { entitySearch } from '../search';
import { Team } from '../teams/team';
import { CrmComment, type CrmThreadWithComments } from './comment';
import { Contact } from './contact';

type CompanyDetail = GetCompanyResponses[200];

/** A CRM company: an organization the team has interacted with. */
export class Company extends PropertiedEntity<CompanyDetail> {
  /** Favorites identify CRM companies as `crm_company`. */
  readonly entityType = 'crm_company';

  /** The properties service identifies CRM companies as `COMPANY`. */
  protected readonly propertyEntityType = 'COMPANY';

  protected async fetch(): Promise<CompanyDetail> {
    return unwrap(
      await this.client.storage.getCompany({
        path: { company_id: this.id },
      }),
    );
  }

  /** A handle to a CRM company by id. Details load on first access. */
  static byId(client: MacroClient, id: string): Company {
    return new Company(client, id);
  }

  /** Build a company from an API record (pre-seeded, no fetch). */
  static from(client: MacroClient, data: CompanyDetail): Company {
    return new Company(client, data.id, data);
  }

  /** The company's display name, if resolved. */
  readonly name = this.field('name');

  /** The company's display description, if any. */
  readonly description = this.field('description');

  /** Whether the company is hidden from CRM listings. */
  readonly hidden = this.field('hidden');

  /** Whether email sync is enabled for this company. */
  readonly emailSync = this.field('emailSync');

  /** The team that owns this company. */
  readonly team = this.mappedField('teamId', (id) =>
    Team.byId(this.client, id),
  );

  /** When the company was first created in the CRM. */
  readonly createdAt = this.field('createdAt');

  /** When the company was last updated. */
  readonly updatedAt = this.field('updatedAt');

  /** The company's primary domain (e.g. `acme.com`), if any. */
  async domain(): Promise<string | undefined> {
    const { domains } = await this.detail.get();
    return domains[0]?.domain;
  }

  /** All domains associated with the company, primary first. */
  async domains(): Promise<string[]> {
    const { domains } = await this.detail.get();
    return domains.map((d) => d.domain);
  }

  /** The contacts attached to this company (hidden ones filtered for non-admins). */
  async contacts(): Promise<Contact[]> {
    const records = unwrap(
      await this.client.storage.listCompanyContacts({
        path: { company_id: this.id },
      }),
    );
    return records.map((r) => Contact.from(this.client, r));
  }

  /** Search CRM companies by name/domain, most relevant first, auto-paginated. */
  static search = entitySearch({
    filters: { crm_company_filters: {} },
    type: 'company',
    includeCrm: true,
    make: (client, hit) => new Company(client, hit.id),
  });

  /**
   * Hide the company from CRM listings: disables email sync and soft-hides
   * its contacts. Reversible with {@link unhide}.
   */
  async hide(): Promise<void> {
    await this.setHidden(true);
  }

  /** Un-hide the company, restoring it and its contacts to CRM listings. */
  async unhide(): Promise<void> {
    await this.setHidden(false);
  }

  private async setHidden(hidden: boolean): Promise<void> {
    await this.mutate((c) =>
      c.storage.setCompanyHidden({
        path: { company_id: this.id },
        body: { hidden },
      }),
    );
  }

  /**
   * Enable or disable team-wide email sync for this company. Rejects with 409
   * when enabling on a hidden company — {@link unhide} first.
   */
  async setEmailSync(enabled: boolean): Promise<void> {
    await this.mutate((c) =>
      c.storage.setEmailSync({
        path: { company_id: this.id },
        body: { email_sync: enabled },
      }),
    );
  }

  /** Rename the company for the caller's current team. */
  async rename(name: string): Promise<void> {
    await this.mutate((c) =>
      c.storage.setCrmCompanyName({
        path: { company_id: this.id },
        body: { name },
      }),
    );
  }

  /** Create a contact under this company. */
  async createContact(opts: { email: string; name: string }): Promise<Contact> {
    const contact = await this.mutate((c) =>
      c.storage.createCrmContact({
        path: { company_id: this.id },
        body: opts,
      }),
    );
    return Contact.from(this.client, contact);
  }

  /** The comment threads attached to this company, with comments oldest first. */
  async comments(): Promise<CrmThreadWithComments[]> {
    const threads = unwrap(
      await this.client.storage.listCrmComments({
        path: { entity_type: 'crm_company', entity_id: this.id },
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
        path: { entity_type: 'crm_company', entity_id: this.id },
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
