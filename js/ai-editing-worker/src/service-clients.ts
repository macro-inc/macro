import type { GetContactsResponse } from '../../app/packages/service-clients/service-contacts/generated/schemas/getContactsResponse';
import type { PostGetNamesRequestBody } from '../../app/packages/service-clients/service-auth/generated/schemas/postGetNamesRequestBody';
import type { UserNames } from '../../app/packages/service-clients/service-auth/generated/schemas/userNames';
import type { UnifiedSearchRequest } from '../../app/packages/service-clients/service-search/generated/models/unifiedSearchRequest';
import type { UnifiedSearchResponse } from '../../app/packages/service-clients/service-search/generated/models/unifiedSearchResponse';
import type {
  ContactResult,
  DocumentResult,
  SearchContacts,
  SearchDocuments,
} from './ai-editing/agents/types';

function bearerHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function fetchDocToken(
  dssBase: string,
  documentId: string,
  userToken: string
): Promise<string> {
  const resp = await fetch(
    `${dssBase}/documents/permissions_token/${documentId}`,
    { method: 'POST', headers: { Authorization: `Bearer ${userToken}` } }
  );
  if (!resp.ok) {
    throw new Error(`failed to get document permission token: ${resp.status}`);
  }
  const { token } = (await resp.json()) as { token: string };
  return token;
}

export function makeSearchDocuments(
  searchBase: string,
  userToken: string
): SearchDocuments {
  return async (query) => {
    const body: UnifiedSearchRequest = {
      query,
      match_type: 'partial',
      search_on: 'name_content',
    };
    const resp = await fetch(`${searchBase}/search?page_size=10`, {
      method: 'POST',
      headers: bearerHeaders(userToken),
      body: JSON.stringify(body),
    });
    if (!resp.ok) return [];
    const data: UnifiedSearchResponse = await resp.json();
    return data.results
      .filter((item) => (item as any).type === 'document')
      .map((item) => {
        const doc = item as any;
        return {
          documentId: doc.document_id as string,
          documentName: doc.document_name as string,
          blockName: (doc.file_type as string) ?? 'md',
        } satisfies DocumentResult;
      });
  };
}

export function makeSearchContacts(
  contactsBase: string,
  authBase: string,
  userToken: string
): SearchContacts {
  return async (query) => {
    const contactsResp = await fetch(`${contactsBase}/contacts`, {
      headers: bearerHeaders(userToken),
    });
    if (!contactsResp.ok) return [];
    const { contacts }: GetContactsResponse = await contactsResp.json();
    if (contacts.length === 0) return [];

    const body: PostGetNamesRequestBody = { user_ids: contacts };
    const namesResp = await fetch(`${authBase}/user/get_names_with_email`, {
      method: 'POST',
      headers: bearerHeaders(userToken),
      body: JSON.stringify(body),
    });
    if (!namesResp.ok) return [];
    const { names }: UserNames = await namesResp.json();

    const q = query.toLowerCase();
    return names
      .filter((u) => {
        const fullName = [u.first_name, u.last_name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return fullName.includes(q) || u.id.toLowerCase().includes(q);
      })
      .map((u) => {
        const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
        // Non-Macro users have IDs like "macro|email@domain.com"
        const email = u.id.startsWith('macro|') ? u.id.slice(6) : '';
        return {
          kind: 'user' as const,
          userId: u.id,
          email,
          name: name || undefined,
        } satisfies ContactResult;
      });
  };
}
