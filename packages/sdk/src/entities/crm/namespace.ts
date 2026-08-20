import type {
  CreateCrmCompanyRequest,
  CrmTeamSettingsResponse,
  UpdateCrmTeamSettingsRequest,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Company } from './company';
import { Contact } from './contact';

export class CrmNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to a CRM company by id. */
  companyById(id: string): Company {
    return Company.byId(this.client, id);
  }

  /** A handle to a CRM contact by id. */
  contactById(id: string): Contact {
    return Contact.byId(this.client, id);
  }

  /** Resolve a CRM contact by email in the caller's current team. */
  async contactByEmail(email: string): Promise<Contact> {
    return Contact.from(
      this.client,
      unwrap(
        await this.client.storage.getContactByEmail({
          query: { email },
        }),
      ),
    );
  }

  /** Create a CRM company for the caller's current team. */
  async createCompany(opts: CreateCrmCompanyRequest): Promise<Company> {
    return Company.from(
      this.client,
      unwrap(await this.client.storage.createCrmCompany({ body: opts })),
    );
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

  /** Search CRM companies by name/domain, most relevant first, auto-paginated. */
  searchCompanies(query: string): AsyncGenerator<Company> {
    return Company.search(this.client, query);
  }
}
