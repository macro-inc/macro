import type { CrmCompany, CrmContact, MacroConfig } from './types';

interface ApiError {
  message: string;
  status: number;
}

class MacroApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'MacroApiError';
  }
}

async function apiRequest<T>(
  config: MacroConfig,
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${config.baseUrl}/api${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiToken}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    let errorMessage = `API error: ${response.status}`;
    try {
      const errorBody = (await response.json()) as ApiError;
      errorMessage = errorBody.message || errorMessage;
    } catch {
      // ignore JSON parse errors
    }
    throw new MacroApiError(errorMessage, response.status);
  }

  return response.json() as Promise<T>;
}

export async function searchCompanies(config: MacroConfig, query: string): Promise<CrmCompany[]> {
  interface SearchResponse {
    hits: Array<{ id: string; name?: string }>;
  }

  const response = await apiRequest<SearchResponse>(
    config,
    `/search?query=${encodeURIComponent(query)}&filters[crm_company_filters]={}&include_crm=true&limit=10`,
  );

  return response.hits.map((hit) => ({
    id: hit.id,
    name: hit.name || 'Unknown',
  }));
}

export async function createCompany(
  config: MacroConfig,
  name: string,
  domain: string,
): Promise<CrmCompany> {
  interface CompanyResponse {
    id: string;
    name?: string;
    domains?: Array<{ domain: string }>;
  }

  const response = await apiRequest<CompanyResponse>(config, '/crm/companies', {
    method: 'POST',
    body: JSON.stringify({ name, domain }),
  });

  return {
    id: response.id,
    name: response.name || name,
    domain: response.domains?.[0]?.domain,
  };
}

export async function getCompanyByDomain(
  config: MacroConfig,
  domain: string,
): Promise<CrmCompany | null> {
  try {
    const companies = await searchCompanies(config, domain);
    return companies[0] || null;
  } catch {
    return null;
  }
}

export async function createContact(
  config: MacroConfig,
  companyId: string,
  name: string,
  email: string,
): Promise<CrmContact> {
  interface ContactResponse {
    id: string;
    name?: string;
    email: string;
    companyId: string;
  }

  const response = await apiRequest<ContactResponse>(
    config,
    `/crm/companies/${companyId}/contacts`,
    {
      method: 'POST',
      body: JSON.stringify({ name, email }),
    },
  );

  return {
    id: response.id,
    name: response.name || name,
    email: response.email,
    companyId: response.companyId,
  };
}

export async function searchContacts(config: MacroConfig, query: string): Promise<CrmContact[]> {
  interface ContactsResponse {
    contacts: Array<{
      id: string;
      name?: string;
      email: string;
      companyId: string;
    }>;
  }

  const response = await apiRequest<ContactsResponse>(
    config,
    `/crm/contacts/search?query=${encodeURIComponent(query)}&limit=10`,
  );

  return response.contacts.map((c) => ({
    id: c.id,
    name: c.name || 'Unknown',
    email: c.email,
    companyId: c.companyId,
  }));
}

export async function getContactByEmail(
  config: MacroConfig,
  email: string,
): Promise<CrmContact | null> {
  interface ContactResponse {
    contact?: {
      id: string;
      name?: string;
      email: string;
      companyId: string;
    };
  }

  try {
    const response = await apiRequest<ContactResponse>(
      config,
      `/crm/contacts/by-email?email=${encodeURIComponent(email)}`,
    );

    if (!response.contact) {
      return null;
    }

    return {
      id: response.contact.id,
      name: response.contact.name || 'Unknown',
      email: response.contact.email,
      companyId: response.contact.companyId,
    };
  } catch {
    return null;
  }
}

export async function verifyToken(config: MacroConfig): Promise<boolean> {
  try {
    await apiRequest(config, '/users/me');
    return true;
  } catch {
    return false;
  }
}
