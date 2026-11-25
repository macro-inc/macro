import type {
  MergeOutcome,
  MergePreview,
  SharingRulesChoice,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

/**
 * A merge's review: the record that stays and the ones merged into it, what
 * moves, the values that differ and which are kept, what email sync does, how
 * many teammates' email sharing names a merged record, and anything that
 * blocks the merge. `revision` binds a commit to it.
 */
export type CrmMergePreview = MergePreview;

/** A committed merge. The merged records' ids open the one that stays. */
export type CrmMergeOutcome = MergeOutcome;

/** The companies a merge names. */
export type CrmCompanyMerge = {
  /** The company that stays; its name, domains and values win. */
  survivorId: string;
  /** The companies merged into it and deleted, at most ten. */
  sourceIds: string[];
};

/** A reviewed merge to commit. */
export type CrmCompanyMergeCommit = CrmCompanyMerge & {
  /** The revision `previewCompanies` returned. */
  revision: string;
  /**
   * One UUID per merge, reused only to retry the same one: a retry returns
   * the first result. Left out, it comes from `revision`, so committing the
   * same review again after a lost response returns that result too.
   */
  requestKey?: string;
  /**
   * Teammates' email sharing that names a merged company: `keep` (the
   * default) shares exactly the same mail, `stop` stops sharing it.
   */
  sharingRules?: SharingRulesChoice;
};

/** The people (contacts) a merge names. */
export type CrmContactMerge = {
  /** The contact that stays; its name, company, primary address and values win. */
  survivorId: string;
  /** The contacts merged into it and deleted, at most ten. */
  sourceIds: string[];
};

/** A reviewed contact merge to commit. */
export type CrmContactMergeCommit = CrmContactMerge & {
  /** The revision `previewContacts` returned. */
  revision: string;
  /**
   * One UUID per merge, reused only to retry the same one: a retry returns
   * the first result. Left out, it comes from `revision`, so committing the
   * same review again after a lost response returns that result too.
   */
  requestKey?: string;
  /**
   * Teammates' email sharing that names a merged contact: `keep` (the
   * default) shares exactly the same mail, `stop` stops sharing it.
   */
  sharingRules?: SharingRulesChoice;
};

/** A request key that is the same for every commit of one review. */
function reviewKey(revision: string): string {
  const hex = revision.toLowerCase();
  if (!/^[0-9a-f]{32,}$/.test(hex)) return crypto.randomUUID();
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Merging duplicate CRM companies, or duplicate people, into one.
 *
 * @routing Use when folding duplicate CRM companies or people (contacts) into the one that stays; not adding another domain or address to a record or editing its fields.
 *
 * @agent
 * ## Merging companies
 *
 * One organization sometimes shows up as several companies, one per domain it mails from. Review the merge with `crm.merges.previewCompanies`, show the user what moves, the values that differ (the company that stays keeps its own) and anything that blocks it, then commit that review with `mergeCompanies` and its `revision`. A merge can't be undone: commit only after the user confirmed the review. People, domains, pipeline entries, references, discussions, favorites and lists move to the company that stays, and the merged companies' ids keep opening it. Only team admins and owners can merge. A refusal's `code` says why: `merge_preview_stale` means something changed since the review, so preview again; `merge_conflict` lists people under different companies who share an address, who need changing first. When a teammate's email sharing names a merged company, `keep` (the default) shares exactly the same mail and `stop` stops sharing it; the review says only how many teammates it affects.
 *
 * ## Merging people
 *
 * One person sometimes shows up as several contacts, one per address they mail from. Merge them the same way with `crm.merges.previewContacts` and `mergeContacts`. The contact that stays keeps its name, company, primary address and values; the others' addresses and mailboxes join it, and their pipeline entries, references, discussions and favorites move to it. A person filed under another company with a work address blocks the merge (`merge_conflict` with `different_companies`): merge their companies first. A person under another company with only personal-provider addresses may join.
 */
export class CrmMergeNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * Review merging companies into the one that stays, without changing
   * anything.
   *
   * @readonly
   */
  async previewCompanies(merge: CrmCompanyMerge): Promise<CrmMergePreview> {
    return unwrap(
      await this.client.storage.previewCrmMerge({
        body: {
          recordType: 'company',
          survivorId: merge.survivorId,
          sourceIds: merge.sourceIds,
        },
      }),
    );
  }

  /**
   * Merge companies into the one that stays, exactly as `previewCompanies`
   * reviewed them. It can't be undone.
   *
   * @destructive
   * @idempotent
   */
  async mergeCompanies(merge: CrmCompanyMergeCommit): Promise<CrmMergeOutcome> {
    return unwrap(
      await this.client.storage.commitCrmMerge({
        body: {
          recordType: 'company',
          survivorId: merge.survivorId,
          sourceIds: merge.sourceIds,
          revision: merge.revision,
          requestKey: merge.requestKey ?? reviewKey(merge.revision),
          sharingRules: merge.sharingRules,
        },
      }),
    );
  }

  /**
   * Review merging people (contacts) into the one that stays, without
   * changing anything.
   *
   * @readonly
   */
  async previewContacts(merge: CrmContactMerge): Promise<CrmMergePreview> {
    return unwrap(
      await this.client.storage.previewCrmMerge({
        body: {
          recordType: 'contact',
          survivorId: merge.survivorId,
          sourceIds: merge.sourceIds,
        },
      }),
    );
  }

  /**
   * Merge people (contacts) into the one that stays, exactly as
   * `previewContacts` reviewed them. It can't be undone.
   *
   * @destructive
   * @idempotent
   */
  async mergeContacts(merge: CrmContactMergeCommit): Promise<CrmMergeOutcome> {
    return unwrap(
      await this.client.storage.commitCrmMerge({
        body: {
          recordType: 'contact',
          survivorId: merge.survivorId,
          sourceIds: merge.sourceIds,
          revision: merge.revision,
          requestKey: merge.requestKey ?? reviewKey(merge.revision),
          sharingRules: merge.sharingRules,
        },
      }),
    );
  }
}
