import type {
  ContactEnrollment,
  EnrollmentAction,
  EnrollmentSummary,
  EnrollRequest,
  EnrollResult,
  Sequence,
  SequenceInput,
  SequenceSummary,
  UpdateSequenceRequest,
} from '@service-email/generated/schemas';
import type { Result } from 'neverthrow';
import { type Accessor, createContext, useContext } from 'solid-js';
import type { SequenceFailure } from '../core/errors';

type Outcome<T> = Promise<Result<T, SequenceFailure>>;

export type SequenceListSource = {
  sequences: Accessor<readonly SequenceSummary[]>;
  pending: Accessor<boolean>;
  /** Why it could not load, when nothing is cached. */
  failure: Accessor<SequenceFailure | undefined>;
  refresh(): Promise<unknown>;
  create(input: SequenceInput): Outcome<Sequence>;
  creating: Accessor<boolean>;
};

export type SequenceSource = {
  sequence: Accessor<Sequence | undefined>;
  enrollments: Accessor<readonly EnrollmentSummary[]>;
  pending: Accessor<boolean>;
  /** Why it could not load, when nothing is cached. */
  failure: Accessor<SequenceFailure | undefined>;
  refresh(): Promise<unknown>;
  update(request: UpdateSequenceRequest): Outcome<Sequence>;
  remove(): Outcome<void>;
  removing: Accessor<boolean>;
};

export type EnrollmentCommands = {
  run(
    enrollment: EnrollmentSummary,
    action: EnrollmentAction
  ): Outcome<EnrollmentSummary>;
  /** Whether an action is still running for this enrollment. */
  pending(enrollmentId: string): boolean;
};

/** A CRM person; the CRM may have no address for them. */
export type Person = { id: string; name: string; email?: string | null };

export type PeopleSource = {
  people: Accessor<readonly Person[]>;
  pending: Accessor<boolean>;
  failed: Accessor<boolean>;
};

export type Enroller = {
  enroll(sequenceId: string, request: EnrollRequest): Outcome<EnrollResult[]>;
  pending: Accessor<boolean>;
};

/** One of the owner's own connected Gmail inboxes. */
export type Sender = { id: string; email: string; ready: boolean };

export type SendersSource = {
  senders: Accessor<readonly Sender[]>;
  pending: Accessor<boolean>;
};

export type ContactEnrollmentsSource = {
  enrollments: Accessor<readonly ContactEnrollment[]>;
  failure: Accessor<SequenceFailure | undefined>;
  refresh(): Promise<unknown>;
};

export type SequencesContext = {
  createSequenceList(): SequenceListSource;
  createSequence(sequenceId: Accessor<string>): SequenceSource;
  createEnrollmentCommands(sequenceId: Accessor<string>): EnrollmentCommands;
  createPeople(search: Accessor<string>): PeopleSource;
  /** People at the companies, past the batch limit so a cut can be shown. */
  createCompanyPeople(companyIds: Accessor<readonly string[]>): PeopleSource;
  createEnroller(): Enroller;
  createSenders(): SendersSource;
  createContactEnrollments(
    crmContactId: Accessor<string>
  ): ContactEnrollmentsSource;
  userId: Accessor<string | undefined>;
  /** A teammate's display name, for the owner on a contact's card. */
  userName(userId: string): string;
  feedback: { success(message: string): void; failure(message: string): void };
};

const Context = createContext<SequencesContext>();

export const SequencesProvider = Context.Provider;

export function useSequences(): SequencesContext {
  const context = useContext(Context);
  if (!context) throw new Error('SequencesProvider is missing');
  return context;
}
