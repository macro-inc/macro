/** A saved interaction is independent from the code run that prepared it. */
export type Review = {
  id: string;
  sessionId: string;
  executionId?: string | null;
  kind: 'email' | 'calendar';
  title: string;
  revision: number;
  updatedAt: number;
  presentedAt?: number | null;
  notificationId?: string | null;
  notificationAttemptAt?: number | null;
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
