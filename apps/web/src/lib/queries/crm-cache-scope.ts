import {
  hasOwnedEmailWitness,
  restSoupAstExcludesCrmContent,
} from '@graphql-cache/authority-scope';

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
      'attachmentReferences',
      'agentSessionActivity',
    ].includes(String(kind))
  )
    return true;
  if (kind === 'soup') {
    // Grouped REST responses retain proof until their group cursors have the
    // same independently scoped parent contract as flat AST pages.
    if (scope !== 'astItems' || key[4] != null) return true;
    return !restSoupAstExcludesCrmContent(key[3]);
  }
  if (kind === 'email') {
    // Legacy thread pages use the entity-granted thread endpoint, which can
    // include CRM-shared mail. Only a current ownership witness exempts them.
    if (scope === 'threadMessages')
      return !(
        key.length === 4 &&
        key[2] === 'messages' &&
        hasOwnedEmailWitness(key[3])
      );
    return ![
      'links',
      'linksHealthProbe',
      'labels',
      'settingsOperations',
      'threadOperations',
      'messageOperation',
      'threadReadReceipts',
      'messageInbox',
      'scheduledMessages',
      'composeDraftState',
      'previews',
    ].includes(String(scope));
  }
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
