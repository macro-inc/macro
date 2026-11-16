import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import type { MentionLinkResolver } from '@core/component/LexicalMarkdown/plugins/text-paste/textPastePlugin';
import type { RecipientSelectorProps } from '@core/component/RecipientSelector';
import type { CombinedRecipientItem } from '@core/user/combinedRecipient';
import type { RecipientSourceFactory } from '@core/user/recipient-source';
import type { LexicalEditor } from 'lexical';
import type { JSX } from 'solid-js';
import type { RosterAgent } from '../../agents-view/core/roster';
import type { SearchTypeValue } from '../../next-soup/core/search-filters';

import type {
  Draft,
  InputFields,
  Intent,
  Scores,
  Submission,
  SubmissionResult,
  Suggestions,
} from '../core/input';
import type { Recipient, RecipientLookup } from '../core/recipients';
import type { InputObservation } from './telemetry';

export type MessageRecipient = RecipientSelectorProps<
  'user' | 'channel'
>['selectedOptions'][number];

/** Options and editor capabilities displayed around the editor, supplied by the application host. */
export interface InputDisplay {
  resolveAppLink?: MentionLinkResolver;
  captureMessageMentions?(read: (() => ItemMention[]) | undefined): void;
  messageChannels(): CombinedRecipientItem<'channel'>[];
  createRecipientSource: RecipientSourceFactory<'user'>;
  createMessageSource: RecipientSourceFactory<'user' | 'channel'>;
  captureCalendarEditor?(editor: LexicalEditor | undefined): void;
  captureEmailEditor?(editor: LexicalEditor | undefined): void;
  person: RecipientLookup;
  searchChannels(): Recipient[];
  recipients(
    fields: Pick<InputFields, 'recipients'>,
    message?: boolean
  ): { recipients: Recipient[]; unresolved: string[] };
  calendars(): { id: string; name: string; emailAddress: string }[];
  selectedCalendar(fields: InputFields): { id: string } | undefined;
  inboxes(): { id: string; email_address: string }[];
  selectedInbox(fields: InputFields): { id: string } | undefined;
  connectGoogle(): Promise<void>;
  connectingGoogle(): boolean;
  roster(): RosterAgent[];
  rosterLoading(): boolean;
  connectAgent(agent: RosterAgent): void;
  createAgent(): void;
  attachmentCount(): number;
  clearAttachments(): void;
}

export interface InputCapabilities {
  observe?(observation: InputObservation): void;
  classify(
    text: string,
    revision: number
  ): Promise<{ revision: number; scores: Scores }>;
  extract(
    text: string,
    intent: Intent,
    revision: number,
    searchType?: SearchTypeValue
  ): Promise<{ revision: number; intent: Intent; suggestions: Suggestions }>;
  submit(input: Submission): Promise<SubmissionResult>;
  saveEmailDraft(input: Submission): Promise<SubmissionResult>;
  validate(input: Submission): string | undefined;
  validateEmailDraft(input: Submission): string | undefined;
  initialDraft?: Draft;
  onSubmitted?(): void;
}

/** Hosts place the shared input and form without changing composer behavior. */
export type InputLayoutParts = {
  editor: JSX.Element;
  fields: JSX.Element;
  result: JSX.Element;
};
export type InputLayout = (parts: InputLayoutParts) => JSX.Element;
