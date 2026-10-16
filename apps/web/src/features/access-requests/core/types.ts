export type AccessLevel = 'view' | 'comment' | 'edit' | 'owner';
export type RequestLevel = 'view' | 'comment' | 'edit';
export type ShareEntity = {
  entityType:
    | 'document'
    | 'chat'
    | 'project'
    | 'initiative'
    | 'database'
    | 'call'
    | 'email_thread'
    | 'agent_session';
  entityId: string;
};
export type AccessRequest = {
  id: string;
  requesterId: string;
  requestedLevel: AccessLevel;
  status: 'pending' | 'granted' | 'denied' | 'cancelled';
  revision: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
  grantedLevel?: AccessLevel | null;
  retryAfter?: string | null;
};
export type RequestState = {
  owner?: string | null;
  canReview: boolean;
  accessLevel?: AccessLevel | null;
  supportedLevels: AccessLevel[];
  mine?: AccessRequest | null;
  requests: AccessRequest[];
  pendingCount: number;
  nextOffset?: number | null;
};
export type DirectAccess = { userId: string; accessLevel: AccessLevel };

export function shareEntity(
  itemType: string,
  id: string
): ShareEntity | undefined {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    return;
  switch (itemType) {
    case 'email':
      return { entityType: 'email_thread', entityId: id };
    case 'document':
    case 'chat':
    case 'project':
    case 'initiative':
    case 'database':
    case 'call':
    case 'email_thread':
    case 'agent_session':
      return { entityType: itemType, entityId: id };
  }
}

export function requestLevels(state: RequestState | undefined): RequestLevel[] {
  if (!state || state.canReview) return [];
  const rank: Record<AccessLevel, number> = {
    view: 0,
    comment: 1,
    edit: 2,
    owner: 3,
  };
  return state.supportedLevels.filter(
    (level): level is RequestLevel =>
      (level === 'view' || level === 'comment' || level === 'edit') &&
      (state.accessLevel == null || rank[level] > rank[state.accessLevel])
  );
}
