/** A saved interaction is independent from the code run that prepared it. */
export type Review = {
  id: string;
  sessionId: string;
  actingUser?: string | null;
  executionId?: string | null;
  kind: 'email' | 'calendar' | 'import';
  title: string;
  revision: number;
  updatedAt: number;
  presentedAt?: number | null;
  /** The most recent decision; `chat` when the agent acted on the account holder's word. */
  decision?: { via: 'card' | 'chat' | 'inbox' } | null;
  items: ReviewItem[];
};
export type ReviewItem = {
  id: string;
  draft: unknown;
  status: 'pending' | 'submitting' | 'completed' | 'dismissed' | 'unknown';
  result?: unknown;
  error?: string | null;
};
export type ReviewDecision =
  | { action: 'edit'; revision: number; item: string; draft: unknown }
  | { action: 'submit' | 'dismiss'; revision: number; items: string[] };
export type ReviewActions = {
  reload: () => Promise<Review>;
  decide: (decision: ReviewDecision) => Promise<Review>;
};

/**
 * Whether the agent answers a decision as soon as it is made. Approving an
 * import only starts its write; the agent answers when the write settles.
 */
export function decisionWakesAgent(
  kind: Review['kind'],
  decision: ReviewDecision
): boolean {
  if (decision.action === 'edit') return false;
  return !(kind === 'import' && decision.action === 'submit');
}
