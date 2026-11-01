import type {
  ContactEnrollment,
  EnrollmentAction,
  EnrollmentDetail,
  EnrollmentSummary,
  EnrollRequest,
  EnrollResult,
  Sequence,
  SequenceInput,
  SequenceSummary,
  UpdateSequenceRequest,
} from '@service-email/generated/schemas';
import type { Result } from 'neverthrow';
import {
  type Accessor,
  createContext,
  type ParentProps,
  useContext,
} from 'solid-js';
import type { SequenceFailure } from '../core/errors';

type Outcome<T> = Promise<Result<T, SequenceFailure>>;

/** The owner's sequences, for the list and the Customers sidebar count. */
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
  updating: Accessor<boolean>;
  remove(): Outcome<void>;
  removing: Accessor<boolean>;
};

/** One enrollment's frozen steps and what happened to each. */
export type EnrollmentSource = {
  detail: Accessor<EnrollmentDetail | undefined>;
  pending: Accessor<boolean>;
  failed: Accessor<boolean>;
  refresh(): Promise<unknown>;
};

export type EnrollmentCommands = {
  run(
    enrollment: EnrollmentSummary,
    action: EnrollmentAction
  ): Outcome<EnrollmentSummary>;
  /** The enrollment an action is running for. */
  pendingId: Accessor<string | undefined>;
};

/** A CRM person who can be enrolled. */
export type Person = { id: string; name: string; email: string };

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

/** A contact's enrollments across the team, without step content. */
export type ContactEnrollmentsSource = {
  enrollments: Accessor<readonly ContactEnrollment[]>;
  pending: Accessor<boolean>;
  failure: Accessor<SequenceFailure | undefined>;
  refresh(): Promise<unknown>;
};

export type SequencesContext = {
  createSequenceList(): SequenceListSource;
  createSequence(sequenceId: Accessor<string>): SequenceSource;
  createEnrollment(enrollmentId: Accessor<string>): EnrollmentSource;
  createEnrollmentCommands(sequenceId: Accessor<string>): EnrollmentCommands;
  createPeople(search: Accessor<string>): PeopleSource;
  createEnroller(): Enroller;
  createSenders(): SendersSource;
  createContactEnrollments(
    crmContactId: Accessor<string>
  ): ContactEnrollmentsSource;
  /** A teammate's display name, for the owner on a contact's card. */
  userName(userId: string): string;
  feedback: { success(message: string): void; failure(message: string): void };
};

const Context = createContext<SequencesContext>();

export function SequencesProvider(
  props: ParentProps<{ value: SequencesContext }>
) {
  return (
    <Context.Provider value={props.value}>{props.children}</Context.Provider>
  );
}

export function useSequences(): SequencesContext {
  const context = useContext(Context);
  if (!context) throw new Error('SequencesProvider is missing');
  return context;
}
