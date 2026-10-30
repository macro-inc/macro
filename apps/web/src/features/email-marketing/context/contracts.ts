import type { CollabMarkdownSession } from '@core/collab-surface/types';
import type { SequenceContentOptions } from '../core/content-identity';
import type {
  Campaign,
  DeliveryIssue,
  Enrollment,
  MarketingContact,
  MarketingSnapshot,
  Sender,
} from '../core/model';

export type { SequenceContentOptions } from '../core/content-identity';

export type SequenceContentSession = CollabMarkdownSession & {
  sourceId: string;
  dispose(): void;
};

export interface MarketingRepository {
  load(): Promise<MarketingSnapshot>;
  saveCampaign(campaign: Campaign): Promise<void>;
  saveEnrollment(enrollment: Enrollment): Promise<void>;
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

export interface SequenceDelivery {
  createDraft(
    senderId: string,
    email: string,
    subject: string,
    body: string
  ): Promise<DraftHandle>;
  schedule(senderId: string, draft: DraftRef, sendAt: string): Promise<void>;
  cancel(
    senderId: string,
    draft: DraftRef
  ): Promise<'canceled' | 'delivery_started'>;
  /**
   * Read back scheduler state for queued steps of one inbox. Returns issues
   * keyed by draft id; steps without a problem are omitted. Optional and
   * non-fatal: callers ignore failures.
   */
  inspect?(
    senderId: string,
    steps: (DraftRef & { sendAt: string })[]
  ): Promise<Record<string, DeliveryIssue>>;
}

export type MarketingCapabilities = {
  repository: MarketingRepository;
  delivery: SequenceDelivery;
  loadContacts(): Promise<MarketingContact[]>;
  searchCrmContacts(query: string): Promise<MarketingContact[]>;
  loadSenders(): Promise<Sender[]>;
  openContact(contact: MarketingContact): void;
  openDatabase(id: string): void;
  composition?: {
    createSession(options: SequenceContentOptions): SequenceContentSession;
  };
};
