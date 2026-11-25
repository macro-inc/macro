/** A company in a merge, as the review names it. */
export type MergeCompany = { id: string; name: string };

/** Someone under another of the companies with an address already filed here. */
export type MergeSameAddressPerson = {
  contactId: string;
  name?: string | null;
  address: string;
  recordId: string;
  archived: boolean;
};

/**
 * Why a merge can't go ahead. `kind` is open: a block this build doesn't
 * know reads as a generic refusal instead of failing.
 */
export type MergeBlock = {
  kind: string;
  people?: MergeSameAddressPerson[];
};

/** A team-visible value that differs: the survivor's wins. */
export type MergeConflict = {
  propertyId: string;
  propertyName: string;
  kept: unknown;
  dropped: { recordId: string; value: unknown }[];
};

/** The review an admin confirms before merging companies. */
export type MergeReview = {
  revision: string;
  survivor: MergeCompany;
  sources: MergeCompany[];
  /** The domains the company that stays has after the merge, its own first. */
  identifiers: string[];
  moves: {
    contacts: number;
    pipelineEntries: number;
    references: number;
    discussionMessages: number;
  };
  /** Pipelines where the company that stays will have several entries. */
  sharedPipelines: { pipelineId: string; name: string; entriesAfter: number }[];
  conflicts: MergeConflict[];
  emailSync: { survivorSyncs: boolean; keptOut: string[] };
  /** How many teammates' email sharing names a merged company. */
  sharingRules?: { teammates: number; keepFits: boolean } | null;
  blocked?: MergeBlock | null;
};

/** What teammates' email sharing naming a merged company becomes. */
export type MergeSharingChoice = 'keep' | 'stop';

/** Why the server refused a review or a commit. */
export type MergeRefusal = {
  /** A server refusal code, or `merge_unconfirmed` when no answer came back. */
  code: string;
  blocked?: MergeBlock | null;
  /** For a company merged since: the company it went into. */
  currentId?: string | null;
};

export type MergeAnswer<T> =
  | { ok: true; value: T }
  | { ok: false; refusal: MergeRefusal };

/** Review and commit company merges. */
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

/** The most companies one merge takes besides the one that stays. */
export const MAX_MERGE_SOURCES = 10;
