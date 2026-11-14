import { excludesCrmContent } from '@graphql-cache/authority-scope';
import { makeGraphqlSoupInput } from './soup/graphql/ast';
import type { SoupAstBody, SoupParams } from './soup/items';

/** Legacy query keys without an entity kind cannot prove a non-CRM scope. */
export function crmProtectedQueryKey(key: readonly unknown[]): boolean {
  const [kind, scope] = key;
  if (
    [
      'crm',
      'preview',
      'activity',
      'agent-activity',
      'attention-feed',
      'favorites',
      'attachmentReferences',
      'agentSessionActivity',
    ].includes(String(kind))
  )
    return true;
  if (kind === 'soup') {
    if (scope !== 'astItems') return true;
    try {
      return !excludesCrmContent(
        makeGraphqlSoupInput({
          params: key[2] as SoupParams,
          body: key[3] as SoupAstBody,
        }).initial?.filters
      );
    } catch {
      return true;
    }
  }
  if (kind === 'email')
    return ![
      'links',
      'linksHealthProbe',
      'labels',
      'settingsOperations',
      'scheduledMessages',
      'composeDraftState',
    ].includes(String(scope));
  if (kind === 'properties') {
    if (scope === 'definitions')
      return !['SYSTEM', 'USER', 'TEAM'].includes(String(key[3]));
    if (scope === 'options') return true;
    return key.some((part) =>
      [
        'COMPANY',
        'CONTACT',
        'CRM_COMPANY',
        'CRM_CONTACT',
        'DATABASE_ROW',
      ].includes(String(part))
    );
  }
  return (
    kind === 'messages' &&
    key.some((part) =>
      typeof part === 'string'
        ? part.startsWith('crm_')
        : !!part &&
          typeof part === 'object' &&
          'type' in part &&
          String(part.type).startsWith('crm_')
    )
  );
}
