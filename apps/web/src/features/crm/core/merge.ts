/** The kind of record a merge folds together. */
export type MergeRecordType = 'company' | 'contact';

/** A company or person in a merge, as the review names it. */
export type MergeRecord = { id: string; name: string };

/** A record offered for a merge, with what tells duplicates apart. */
export type MergeCandidate = MergeRecord & {
  /** A company's domains, or a person's address. */
  identifiers: string[];
  /** A person's company. */
  company?: string | null;
};

/** Records of one type that a merge starts from; one means "merge with…". */
export type MergeSelection = {
  recordType: MergeRecordType;
  records: MergeCandidate[];
};

/** Someone under another of the companies with an address already filed here. */
export type MergeSameAddressPerson = {
  contactId: string;
  name?: string | null;
  address: string;
  recordId: string;
  archived: boolean;
};

/** A person merged away who is filed under another company than the one kept. */
export type MergeOtherCompanyPerson = {
  contactId: string;
  name?: string | null;
  companyId: string;
  companyName: string;
};

/**
 * Why a merge can't go ahead. A block this build doesn't know arrives as
 * `unknown` and reads as a generic refusal instead of failing.
 */
export type MergeBlock =
  | { kind: 'same_address_people'; people: MergeSameAddressPerson[] }
  | { kind: 'different_companies'; people: MergeOtherCompanyPerson[] }
  | { kind: 'unknown' };

/** A team-visible value that differs: the survivor's wins. */
export type MergeConflict = {
  propertyId: string;
  propertyName: string;
  kept: unknown;
  dropped: { recordId: string; value: unknown }[];
};

/** The review an admin confirms before merging companies or people. */
export type MergeReview = {
  revision: string;
  survivor: MergeRecord;
  sources: MergeRecord[];
  /**
   * What the record that stays is known by after the merge, its own first:
   * a company's domains, a person's addresses.
   */
  identifiers: string[];
  moves: {
    contacts: number;
    pipelineEntries: number;
    references: number;
    discussionMessages: number;
  };
  /** Pipelines where the record that stays will have several entries. */
  sharedPipelines: { pipelineId: string; name: string; entriesAfter: number }[];
  conflicts: MergeConflict[];
  emailSync: { survivorSyncs: boolean; keptOut: string[] };
  /** How many teammates' email sharing names a merged record. */
  sharingRules?: { teammates: number; keepFits: boolean } | null;
  blocked?: MergeBlock | null;
};

/** What teammates' email sharing naming a merged record becomes. */
export type MergeSharingChoice = 'keep' | 'stop';

/** Why the server refused a review or a commit. */
export type MergeRefusal = {
  /** A server refusal code, or `merge_unconfirmed` when no answer came back. */
  code: string;
  blocked?: MergeBlock | null;
  /** For a record merged since: the record it went into. */
  currentId?: string | null;
};

export type MergeAnswer<T> =
  | { ok: true; value: T }
  | { ok: false; refusal: MergeRefusal };

/** Review and commit merges of one record type. */
export type MergeCommands = {
  review(input: {
    survivorId: string;
    sourceIds: string[];
  }): Promise<MergeAnswer<MergeReview>>;
  commit(input: {
    survivorId: string;
    sourceIds: string[];
    revision: string;
    requestKey: string;
    sharingRules: MergeSharingChoice;
  }): Promise<MergeAnswer<{ survivorId: string; mergedIds: string[] }>>;
};

/** The most records one merge takes besides the one that stays. */
export const MAX_MERGE_SOURCES = 10;
