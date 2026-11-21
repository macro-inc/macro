/** Legacy query keys without an entity kind cannot prove a non-CRM scope. */
export function crmProtectedQueryKey(key: readonly unknown[]): boolean {
  const [kind, scope] = key;
  // These owner-authorized privacy controls remain available without CRM
  // viewing access. Session/account retirement still clears every key.
  if (kind === 'crm')
    return ![
      'emailPrivacy',
      'emailConsent',
      'excludedEmailThreads',
      'emailPolicy',
      'emailPolicyHistory',
      'emailPolicyRevision',
      'emailPolicyPreview',
    ].includes(String(scope));
  if (
    [
      'preview',
      'activity',
      'agent-activity',
      'attention-feed',
      'attachmentReferences',
      'agentSessionActivity',
    ].includes(String(kind))
  )
    return true;
  if (kind === 'soup') return true;
  if (kind === 'email') {
    // Retire copied mail on a proven denial. Normalized email-thread storage
    // is separate from the disabled legacy TanStack thread scope.
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
