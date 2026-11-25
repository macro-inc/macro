import type {
  MergeOutcome,
  MergePreview,
  SharingRulesChoice,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

/**
 * A merge's review: the company that stays and the ones merged into it, what
 * moves, the values that differ and which are kept, what email sync does, how
 * many teammates' email sharing names a merged company, and anything that
 * blocks the merge. `revision` binds a commit to it.
 */
export type CrmMergePreview = MergePreview;

/** A committed merge. The merged companies' ids open the one that stays. */
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
 * Merging duplicate CRM companies into one.
 *
 * @routing Use when folding duplicate CRM companies into the one that stays; not adding another domain to a company or editing its fields.
 *
 * @agent
 * ## Merging companies
 *
 * One organization sometimes shows up as several companies, one per domain it mails from. Review the merge with `crm.merges.previewCompanies`, show the user what moves, the values that differ (the company that stays keeps its own) and anything that blocks it, then commit that review with `mergeCompanies` and its `revision`. A merge can't be undone: commit only after the user confirmed the review. People, domains, pipeline entries, references, discussions, favorites and lists move to the company that stays, and the merged companies' ids keep opening it. Only team admins and owners can merge. A refusal's `code` says why: `merge_preview_stale` means something changed since the review, so preview again; `merge_conflict` lists people under different companies who share an address, who need changing first. When a teammate's email sharing names a merged company, `keep` (the default) shares exactly the same mail and `stop` stops sharing it; the review says only how many teammates it affects.
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
}
