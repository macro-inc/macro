export type BrainAccessScope = Readonly<{
  viewer: string;
  team: string;
  agent: string;
}>;

export type AccessKind = 'login' | 'api' | 'card';
export type AccessLevel = 'View' | 'Edit';

export type AccessRequest = {
  id: string;
  name: string;
  reason: string;
  requestedAt: string;
} & ({ kind: 'card' } | { kind: 'login' | 'api'; level: AccessLevel });

export type AccessRecord = {
  itemId: string;
  name: string;
  updatedAt: string;
} & (
  | { state: 'granted'; level: AccessLevel; standing: boolean }
  | { state: 'pending'; level: AccessLevel }
  | { state: 'no-access' }
);

export type AccessOutcome =
  | { state: 'linked'; itemName: string }
  | { state: 'added' }
  | { state: 'awaiting-human' }
  | { state: 'declined' };

export type AccessReview = {
  request: AccessRequest;
  choices: readonly { id: string; name: string }[];
  outcome?: AccessOutcome;
};

export type BrainAccessView = {
  agentName: string;
  teamName: string;
  settingUp: boolean;
  viewerLabel: string;
  canResolveItemless: boolean;
  records: readonly AccessRecord[];
  reviews: readonly AccessReview[];
};

export type AccessDecision = { requestId: string } & (
  | { action: 'link'; itemId: string }
  | { action: 'add'; itemName: string }
  | { action: 'decline' }
);

export interface BrainAccessSource {
  read(scope: BrainAccessScope): BrainAccessView | undefined;
  decide(
    scope: BrainAccessScope,
    decision: AccessDecision
  ): 'resolved' | 'denied' | 'unavailable';
}
