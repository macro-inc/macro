import type { MacroClient } from '../../utils/client';
import {
  type ImportedEntity,
  ImportItem,
  type ImportItemFilters,
  type ImportResult,
  type TrackedItem,
} from './import-item';
import { NotionWorkspaceImport, WorkspaceImport } from './workspace-import';

/**
 * The import ledger: every external item staged, imported or declined, so
 * nothing is imported twice.
 */
export class ImportLedger {
  constructor(private readonly client: MacroClient) {}

  /**
   * The user's ledger, newest first: staged candidates, items being
   * imported, imported items (teammates' team imports too) and declined ones.
   */
  list(filters?: ImportItemFilters): Promise<ImportItem[]> {
    return ImportItem.list(this.client, filters);
  }

  /** A handle to a ledger item by id. Details load on first access. */
  byId(id: string): ImportItem {
    return ImportItem.byId(this.client, id);
  }

  /**
   * Propose an external item for import before creating anything. Check the
   * outcome: a copy may already exist, or the user may have declined it.
   */
  stage(item: TrackedItem): Promise<ImportResult> {
    return ImportItem.track(this.client, item);
  }

  /**
   * Record a Macro item you already created from an external item, so it is
   * never imported twice.
   */
  async recordImported(
    item: TrackedItem,
    entity: ImportedEntity,
  ): Promise<ImportItem> {
    return (await ImportItem.track(this.client, item, entity)).item;
  }

  /**
   * Decline a staged candidate on the user's behalf: it is remembered and not
   * proposed again. Only the user's own staged items can be declined.
   */
  decline(item: ImportItem): Promise<void> {
    return item.decline();
  }
}

/**
 * Bring Notion, Linear, Jira and Slack content into Macro, tracked in the
 * import ledger so nothing is imported twice.
 *
 * @agent
 * ## Whole workspaces (Notion, Linear, Jira)
 *
 * - Anything bigger than one Notion page goes through a reviewed plan:
 *   `macro.imports.notion.plan(...)` (or `.linear` / `.jira`). Never recreate
 *   plan items with document, task or database methods.
 * - Unless the user already said who should see the import, plan without
 *   `sharing` first. A 409 `sharing_required` means they are on a team: ask in
 *   one short question whether to share it with their team, keep it to
 *   themselves, or let AI decide per page, then plan again with their answer.
 *   A report with `onTeam: false` means everything is personal; don't offer
 *   team sharing.
 * - Present the plan in the same program, right after `plan` returns, even
 *   while it is still `running`: `const review = await
 *   execution.reviews.create({kind: 'import', title: 'Import from Notion',
 *   drafts: [{source: 'notion'}]})`, and return `reviews: [await
 *   review.reference()]`. The card fills in as planning goes; don't wait for
 *   it or poll `status()`. Tell the user the plan's counts as they are, and
 *   end by asking "Should I kick it off?".
 * - Nothing is written until the review is approved. If the user says yes,
 *   start it in a later program with
 *   `macro.imports.notion.start(execution.session().reviews.byId(id))`; while
 *   the plan is still being made it is refused, so say it isn't ready yet.
 * - `cancel()` stops planning or writing; what was imported stays.
 *
 * ## Single items and the ledger
 *
 * - One Notion page: `macro.imports.notion.importPage(url)`, never fetch and
 *   recreate it.
 * - Before creating Macro items from external ones yourself, check
 *   `ledger.list()`, `ledger.stage()` candidates, and `ledger.recordImported()`
 *   each item you create. An `already_imported*` outcome means a copy exists:
 *   point the user at `item.entity()` instead of creating a duplicate.
 */
export class ImportsNamespace {
  /** The Notion workspace import, and single Notion page imports. */
  readonly notion: NotionWorkspaceImport;

  /** The Linear workspace import: issues become tasks, their groups projects. */
  readonly linear: WorkspaceImport;

  /** The Jira Cloud import: issues become tasks, projects and epics projects. */
  readonly jira: WorkspaceImport;

  /** What was staged, imported or declined, across every source. */
  readonly ledger: ImportLedger;

  constructor(client: MacroClient) {
    this.notion = new NotionWorkspaceImport(client);
    this.linear = new WorkspaceImport(client, 'linear');
    this.jira = new WorkspaceImport(client, 'jira');
    this.ledger = new ImportLedger(client);
  }
}
