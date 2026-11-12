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
import type { Document } from '../documents/document';
import { Company } from './company';
import { Contact } from './contact';
import { CrmPipeline } from './pipeline';
import { type CompanyImport, pipelineImport } from './pipeline-entry';
import { PipelineNamespace } from './pipelines';

/**
 * @routing Use when working with CRM deals, pipelines, stages, companies or contacts; not generic databases, and not a search that merely names a company.
 *
 * @agent
 * ## How CRM pipelines work
 *
 * A pipeline is a board of deals. Each entry tracks one CRM company or contact and has its own fields: usually Stage, Owner and Revenue, plus any the team added. "Deal", "opportunity", "lead", "the pipeline", "move Acme to Negotiation" and "who's in Demo" all refer to pipeline entries. A pipeline is not a Macro database: work with it through the CRM pipeline methods, never database queries or SQL.
 *
 * Work with entries by name through the pipeline's own methods: `find` (filters by field name and stage label, with per-stage counts and number totals such as Revenue), `addRecords`, `updateEntries` (a stage by its label, a person as `'me'`), `removeRecords`, and `edit` for fields and stage options. `importCsv` / `exportCsv` move entries through CSV, and `crm.importCompaniesCsv` loads a companies list. `crm.pipelines.entriesFor` and `searchEntries` find a company's deals across pipelines. Reach for `applyOps` and column ids only for what these cannot express.
 *
 * A company also has its own Stage, Owner and Revenue properties on its CRM page. They are separate from every pipeline and not kept in sync with it. When the user has pipelines, deal and stage requests mean pipeline entries; change the company's own properties only when the user asks for those properties specifically.
 */
export class CrmNamespace {
  /** Pipelines, their records and sharing settings. */
  readonly pipelines: PipelineNamespace;

  constructor(private readonly client: MacroClient) {
    this.pipelines = new PipelineNamespace(client);
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
   * Create a CRM company for the caller's current team.
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
   * Create a contact without a company for the caller's current team. The
   * email is optional and may be at any domain. To add someone to a company,
   * use {@link Company.createContact}.
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
   * Block a domain (like `acme.com`): email sync skips it, and the company
   * that owns it, that company's contacts, and contacts without a company at
   * the domain are hidden. A contact attached to another company follows that
   * company's domains. Requires a team admin or owner.
   *
   * @destructive
   * @idempotent
   */
  async blockDomain(domain: string): Promise<void> {
    unwrap(await this.client.storage.blockCrmDomain({ path: { domain } }));
  }

  /**
   * Unblock a domain: email sync resumes for addresses the team's
   * personal-email and generic-provider filters allow. Contacts without a
   * company at this domain are shown again. Its company and attached contacts
   * stay hidden until the company's last blocked domain is removed, then are
   * shown even if hidden by hand before blocking. Requires a team admin or owner.
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
   * Search CRM companies by name/domain, most relevant first, auto-paginated.
   *
   * @readonly
   */
  searchCompanies(query: string): AsyncGenerator<Company> {
    return Company.search(this.client, query);
  }
}
