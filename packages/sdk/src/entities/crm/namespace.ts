import type {
  CreateCrmCompanyRequest,
  CreateCrmTeamContactRequest,
  CrmStagesResponse,
  CrmTeamSettingsResponse,
  PipelineSharing,
  ReplaceCrmStagesRequest,
  UpdateCrmTeamSettingsRequest,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { CrmEmailPrivacyNamespace } from '../crm-email-privacy/email-privacy';
import type { Document } from '../documents/document';
import type { SearchOpts } from '../search/options';
import { Team } from '../teams/team';
import { Company } from './company';
import { Contact } from './contact';
import { CrmPipeline } from './pipeline';
import { type CompanyImport, pipelineImport } from './pipeline-entry';
import { PipelineNamespace } from './pipelines';

/**
 * @routing Use when working with CRM records and pipelines; not generic databases or email contribution.
 *
 * @agent
 * ## How CRM pipelines work
 *
 * A pipeline is a board of deals. Each entry tracks one CRM company or contact and has its own fields: usually Stage, Owner and Revenue, plus any the team added. "Deal", "opportunity", "lead", "the pipeline", "move Acme to Negotiation" and "who's in Demo" all refer to pipeline entries. A pipeline is not a Macro database: work with it through the CRM pipeline methods, never database queries or SQL.
 *
 * Create a pipeline with its stages and fields in one `crm.pipelines.create` call. Work with entries by name through the pipeline's own methods: `find` (filters by field name and stage label, with per-stage counts and number totals such as Revenue), `addRecords`, `updateEntries` (a stage by its label, a person as `'me'`), `removeRecords`, and `edit` for fields and stage options. `importCsv` / `exportCsv` move entries through CSV, and `crm.importCompaniesCsv` loads a companies list. `crm.pipelines.entriesFor` and `searchEntries` find a company's deals across pipelines. Reach for `applyOps` and column ids only for what these cannot express.
 *
 * Find a company before creating one: `crm.companyByDomain` by its domain, `crm.searchCompanies` by its name. Create it only when neither finds it; `createCompany` refuses a domain the team already tracks.
 *
 * A company also has its own Stage, Owner and Revenue properties on its CRM page. They are separate from every pipeline and not kept in sync with it. When the user has pipelines, deal and stage requests mean pipeline entries; change the company's own properties only when the user asks for those properties specifically.
 *
 * Companies and contacts both take the team's custom properties, such as a phone number or a LinkedIn link: create the definition once with `properties.create` (scope `team`), then call `setProperty` on each company or contact and read them back with `properties()`.
 */
export class CrmNamespace {
  /** Your email contribution. */
  readonly emailPrivacy: CrmEmailPrivacyNamespace;

  /** Pipelines, their records and sharing settings. */
  readonly pipelines: PipelineNamespace;

  constructor(private readonly client: MacroClient) {
    this.pipelines = new PipelineNamespace(client);
    this.emailPrivacy = new CrmEmailPrivacyNamespace(client);
  }

  /**
   * Read the caller's current CRM access, including when access is denied.
   * Existing handles do not bypass the server's current permission checks.
   *
   * @readonly
   */
  async access(): Promise<{ team?: Team; allowed: boolean }> {
    const access = unwrap(await this.client.storage.getCrmMemberAccess());
    return {
      team: access.team_id ? Team.byId(this.client, access.team_id) : undefined,
      allowed: access.allowed,
    };
  }

  /**
   * A handle to a CRM company by id.
   *
   * @readonly
   */
  companyById(id: string): Company {
    return Company.byId(this.client, id);
  }

  /**
   * A handle to a CRM contact by id.
   *
   * @readonly
   */
  contactById(id: string): Contact {
    return Contact.byId(this.client, id);
  }

  /**
   * Resolve a CRM contact by email in the caller's current team, if present.
   *
   * @readonly
   */
  async contactByEmail(email: string): Promise<Contact | undefined> {
    const { contact } = unwrap(
      await this.client.storage.getContactByEmail({
        query: { email },
      }),
    );
    return contact ? Contact.from(this.client, contact) : undefined;
  }

  /**
   * The team's company for a domain. Exact and current, unlike
   * {@link searchCompanies}, so use it after `createCompany` reports the domain
   * is already tracked. An archived company is returned to team admins only.
   *
   * @readonly
   */
  async companyByDomain(domain: string): Promise<Company | undefined> {
    const { company } = unwrap(
      await this.client.storage.getCompanyByDomain({ query: { domain } }),
    );
    return company ? Company.from(this.client, company) : undefined;
  }

  /**
   * Search the caller's current team's CRM contacts whose email or name
   * contains `query` (case-insensitive), most recently interacted first.
   * An empty query lists the most recent contacts.
   *
   * @param opts.limit Maximum contacts to return (1-500, default 20).
   *
   * @readonly
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

  /**
   * Create a CRM company for the caller's current team. Look it up first with
   * {@link companyByDomain} or {@link searchCompanies}: a domain the team
   * already tracks is refused.
   *
   * @write
   */
  async createCompany(opts: CreateCrmCompanyRequest): Promise<Company> {
    return Company.from(
      this.client,
      unwrap(await this.client.storage.createCrmCompany({ body: opts })),
    );
  }

  /**
   * Create a contact for the caller's current team. The email is optional; a
   * work address links the contact to its domain's company, created if
   * missing. To choose the company, find it with {@link companyByDomain} or
   * {@link searchCompanies} and use {@link Company.createContact}.
   *
   * @write
   */
  async createContact(opts: CreateCrmTeamContactRequest): Promise<Contact> {
    return Contact.from(
      this.client,
      unwrap(await this.client.storage.createCrmTeamContact({ body: opts })),
    );
  }

  /**
   * The domains the caller's current team keeps out of email sync.
   *
   * @readonly
   */
  async blockedDomains(): Promise<string[]> {
    return unwrap(await this.client.storage.listCrmBlockedDomains()).map(
      (blocked) => blocked.domain,
    );
  }

  /**
   * Block a domain from email sync without changing existing CRM records.
   *
   * Existing companies, contacts and their hidden states are preserved.
   * Requires a team admin or owner.
   *
   * @destructive
   * @idempotent
   * @throws When the domain equals or covers a member's connected primary
   * mailbox domain. The error preserves the server's explanation.
   */
  async blockDomain(domain: string): Promise<void> {
    unwrap(await this.client.storage.blockCrmDomain({ path: { domain } }));
  }

  /**
   * Resume eligible email sync for a domain without changing existing CRM records.
   *
   * Email sync resumes for addresses the team's personal-email and
   * generic-provider filters allow. Existing companies, contacts and their
   * hidden states are preserved. Requires a team admin or owner.
   *
   * @write
   * @idempotent
   */
  async unblockDomain(domain: string): Promise<void> {
    unwrap(await this.client.storage.unblockCrmDomain({ path: { domain } }));
  }

  /**
   * The caller's current team's CRM settings.
   *
   * @readonly
   */
  async settings(): Promise<CrmTeamSettingsResponse> {
    return unwrap(await this.client.storage.getCrmTeamSettings());
  }

  /**
   * Partially update the caller's current team's CRM settings.
   *
   * @write
   * @idempotent
   */
  async updateSettings(
    settings: UpdateCrmTeamSettingsRequest,
  ): Promise<CrmTeamSettingsResponse> {
    return unwrap(
      await this.client.storage.putCrmTeamSettings({ body: settings }),
    );
  }

  /**
   * Replace the caller's current team's deal stages, in pipeline order.
   *
   * @destructive
   * @idempotent
   */
  async setStages(stages: ReplaceCrmStagesRequest): Promise<CrmStagesResponse> {
    return unwrap(await this.client.storage.putCrmTeamStages({ body: stages }));
  }

  /**
   * Reset the caller's current team's deal stages to the defaults.
   *
   * @destructive
   * @idempotent
   */
  async resetStages(): Promise<void> {
    unwrap(await this.client.storage.resetCrmTeamStages());
  }

  /**
   * Create the companies a CSV lists (CSV text, or a CSV document), keyed by
   * domain; companies the team already has are counted, not duplicated. When
   * the CSV has Stage, Owner or Revenue columns, those go on entries of
   * `pipeline` (a company pipeline), or of a new pipeline (private unless
   * `newPipeline.sharing` is `team`, named after the file unless named).
   *
   * @write
   */
  async importCompaniesCsv(
    source: string | Document,
    options: {
      pipeline?: CrmPipeline;
      newPipeline?: { name?: string; sharing?: PipelineSharing };
    } = {},
  ): Promise<CompanyImport> {
    const outcome = unwrap(
      await this.client.storage.importCrmCompaniesCsv({
        body: {
          ...(typeof source === 'string'
            ? { csv: source }
            : { documentId: source.id }),
          pipelineId: options.pipeline?.id,
          newPipeline: options.newPipeline,
        },
      }),
    );
    const { pipeline, ...counts } = outcome;
    return {
      ...counts,
      pipeline: pipeline
        ? pipelineImport(
            options.pipeline ??
              CrmPipeline.byId(this.client, pipeline.pipelineId),
            pipeline,
          )
        : undefined,
    };
  }

  /**
   * Search CRM companies by name/domain, most relevant first, auto-paginated; `maxItems` caps the total.
   *
   * @readonly
   */
  searchCompanies(query: string, opts?: SearchOpts): AsyncGenerator<Company> {
    return Company.search(this.client, query, opts);
  }
}
