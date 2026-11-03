import type {
  CreateCrmCompanyRequest,
  CreateCrmTeamContactRequest,
  CrmStagesResponse,
  CrmTeamSettingsResponse,
  ReplaceCrmStagesRequest,
  UpdateCrmTeamSettingsRequest,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Company } from './company';
import { Contact } from './contact';
import { PipelineNamespace } from './pipelines';

export class CrmNamespace {
  /** Pipelines, their records and sharing settings. */
  readonly pipelines: PipelineNamespace;

  constructor(private readonly client: MacroClient) {
    this.pipelines = new PipelineNamespace(client);
  }

  /** A handle to a CRM company by id. */
  companyById(id: string): Company {
    return Company.byId(this.client, id);
  }

  /** A handle to a CRM contact by id. */
  contactById(id: string): Contact {
    return Contact.byId(this.client, id);
  }

  /** Resolve a CRM contact by email in the caller's current team, if present. */
  async contactByEmail(email: string): Promise<Contact | undefined> {
    const { contact } = unwrap(
      await this.client.storage.getContactByEmail({
        query: { email },
      }),
    );
    return contact ? Contact.from(this.client, contact) : undefined;
  }

  /**
   * Search the caller's current team's CRM contacts whose email or name
   * contains `query` (case-insensitive), most recently interacted first.
   * An empty query lists the most recent contacts.
   *
   * @param opts.limit Maximum contacts to return (1-500, default 20).
   */
  async searchContacts(
    query: string,
    opts: { limit?: number } = {},
  ): Promise<Contact[]> {
    const { contacts } = unwrap(
      await this.client.storage.searchContacts({
        query: { query, limit: opts.limit },
      }),
    );
    return contacts.map((contact) => Contact.from(this.client, contact));
  }

  /** Create a CRM company for the caller's current team. */
  async createCompany(opts: CreateCrmCompanyRequest): Promise<Company> {
    return Company.from(
      this.client,
      unwrap(await this.client.storage.createCrmCompany({ body: opts })),
    );
  }

  /**
   * Create a contact without a company for the caller's current team. The
   * email is optional and may be at any domain. To add someone to a company,
   * use {@link Company.createContact}.
   */
  async createContact(opts: CreateCrmTeamContactRequest): Promise<Contact> {
    return Contact.from(
      this.client,
      unwrap(await this.client.storage.createCrmTeamContact({ body: opts })),
    );
  }

  /** The domains the caller's current team keeps out of email sync. */
  async blockedDomains(): Promise<string[]> {
    return unwrap(await this.client.storage.listCrmBlockedDomains()).map(
      (blocked) => blocked.domain,
    );
  }

  /**
   * Block a domain (like `acme.com`): email sync skips it, and the company
   * that owns it, that company's contacts, and contacts without a company at
   * the domain are hidden. A contact attached to another company follows that
   * company's domains. Requires a team admin.
   */
  async blockDomain(domain: string): Promise<void> {
    unwrap(await this.client.storage.blockCrmDomain({ path: { domain } }));
  }

  /**
   * Unblock a domain: email sync resumes for addresses the team's
   * personal-email and generic-provider filters allow, and what blocking hid
   * is shown again. This clears the hidden flag on the domain's company even
   * if it was hidden by hand before blocking. Requires a team admin.
   */
  async unblockDomain(domain: string): Promise<void> {
    unwrap(await this.client.storage.unblockCrmDomain({ path: { domain } }));
  }

  /** The caller's current team's CRM settings. */
  async settings(): Promise<CrmTeamSettingsResponse> {
    return unwrap(await this.client.storage.getCrmTeamSettings());
  }

  /** Partially update the caller's current team's CRM settings. */
  async updateSettings(
    settings: UpdateCrmTeamSettingsRequest,
  ): Promise<CrmTeamSettingsResponse> {
    return unwrap(
      await this.client.storage.putCrmTeamSettings({ body: settings }),
    );
  }

  /** Replace the caller's current team's deal stages, in pipeline order. */
  async setStages(stages: ReplaceCrmStagesRequest): Promise<CrmStagesResponse> {
    return unwrap(await this.client.storage.putCrmTeamStages({ body: stages }));
  }

  /** Reset the caller's current team's deal stages to the defaults. */
  async resetStages(): Promise<void> {
    unwrap(await this.client.storage.resetCrmTeamStages());
  }

  /** Search CRM companies by name/domain, most relevant first, auto-paginated. */
  searchCompanies(query: string): AsyncGenerator<Company> {
    return Company.search(this.client, query);
  }
}
