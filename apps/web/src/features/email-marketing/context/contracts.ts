import type { CollabMarkdownSession } from '@core/collab-surface/types';
import type { SequenceContentOptions } from '../core/content-identity';
import type {
  Campaign,
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

export interface SequenceDelivery {
  createDraft(
    senderId: string,
    email: string,
    subject: string,
    body: string
  ): Promise<string>;
  schedule(senderId: string, draftId: string, sendAt: string): Promise<void>;
  cancel(
    senderId: string,
    draftId: string
  ): Promise<'canceled' | 'delivery_started'>;
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
