import type {
  Campaign,
  DeliveryIssue,
  Enrollment,
  MarketingContact,
  MarketingSnapshot,
  Sender,
  Unsubscribe,
} from '../core/model';

export interface MarketingRepository {
  load(): Promise<MarketingSnapshot>;
  saveCampaign(campaign: Campaign): Promise<void>;
  saveEnrollment(enrollment: Enrollment): Promise<void>;
  /** Remove a campaign and its enrollment records in one write. */
  deleteCampaign(campaignId: string, enrollmentIds: string[]): Promise<void>;
  saveUnsubscribe(entry: Unsubscribe): Promise<void>;
}

/** The server's handle for a created draft. */
export type DraftHandle = {
  id: string;
  /** Edit generation the server expects on later schedule/cancel/delete calls. */
  generation: number;
  threadId?: string;
};

/** A persisted draft reference. Rows written before generations existed omit it. */
export type DraftRef = {
  draftId: string;
  generation?: number;
  threadId?: string;
};

export type Inspection = {
  issues: Record<string, DeliveryIssue>;
  untracked: string[];
};

export type DraftContent = {
  email: string;
  subject: string;
  body: string;
  /** An earlier step's draft this one replies to, in its thread. */
  replyingToId?: string;
};

export interface SequenceDelivery {
  createDraft(senderId: string, content: DraftContent): Promise<DraftHandle>;
  schedule(senderId: string, draft: DraftRef, sendAt: string): Promise<void>;
  cancel(
    senderId: string,
    draft: DraftRef
  ): Promise<'canceled' | 'delivery_started'>;
  /**
   * Read back the scheduler for one inbox's queued steps: problems keyed by
   * draft id (steps without one are omitted), and scheduled sequence emails
   * that none of `steps` accounts for.
   */
  inspect(
    senderId: string,
    steps: (DraftRef & { sendAt: string })[]
  ): Promise<Inspection>;
}

export type MarketingCapabilities = {
  repository: MarketingRepository;
  delivery: SequenceDelivery;
  loadContacts(): Promise<MarketingContact[]>;
  searchCrmContacts(query: string): Promise<MarketingContact[]>;
  loadSenders(): Promise<Sender[]>;
  openContact(contact: MarketingContact): void;
  openDatabase(id: string): void;
  /** Open a step's email thread in Mail. */
  openThread(threadId: string): void;
};
