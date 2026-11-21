import { match } from 'ts-pattern';
import type {
  ImportNotionPageResult,
  ImportSource,
  ImportStatus,
  TrackImportOutcome,
} from '../../../generated/cognition/types.gen';
import { MacroError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Channel } from '../channels/channel';
import { Task } from '../tasks/task';
import { ImportEntry, type ImportedItem } from './entry';
import {
  NotionWorkspaceImport,
  TrackerWorkspaceImport,
} from './workspace-import';

/** An external item to track in the import ledger. */
export interface ImportCandidate {
  /** The external system the item comes from. */
  source: ImportSource;
  /**
   * The item's stable id in its source: a Linear identifier such as
   * `ENG-142`, a Notion page URL or id, or a Slack channel id.
   */
  foreignId: string;
  /**
   * What the source says about it. Linear: `{identifier, title,
   * description?, status?, priority?, assignee?, assignee_email?, url?}`;
   * Notion: `{title, url?, summary?}`, never the page content; Slack:
   * `{name, channel_id?, purpose?, participants?}`.
   */
  metadata: Record<string, unknown>;
}

/** What tracking an item did, with its ledger entry. */
export interface TrackedImport {
  /**
   * `staged` or `recorded_imported` when the ledger took it;
   * `already_imported` and `already_imported_by_teammate` mean it exists in
   * Macro (`entry.item()`), so do not create a duplicate;
   * `previously_declined` means skip it; `import_in_progress` means leave it.
   */
  outcome: TrackImportOutcome;
  /** The ledger entry behind the outcome. */
  entry: ImportEntry;
}

/** What importing one Notion page did. */
export interface NotionPageImport {
  /**
   * `imported`, or `already_imported` / `already_imported_by_teammate` when
   * the page was a Macro document before; `previously_declined` and
   * `import_in_progress` imported nothing.
   */
  outcome: ImportNotionPageResult;
  /** The ledger entry; `entry.item()` is the document once imported. */
  entry: ImportEntry;
}

/**
 * Bring Notion, Linear and Jira content into Macro, tracked in the import
 * ledger so nothing is imported twice: the external items (Linear and Jira
 * issues, Notion pages, Slack channels) the caller has proposed for import,
 * imported, or declined, with the team's imports. Slack channels are imported
 * from Settings; the ledger only lists them.
 *
 * @routing Use when importing a Notion, Linear or Jira workspace, a single Notion page, tracking one external item being copied into Macro, or checking what was already imported; not resolving one linked external item, which is foreign entities.
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
 * - If the report is `failed` (e.g. the source isn't connected), say why and
 *   offer to connect it; don't present a review.
 * - Present the plan in the same program, right after `plan` returns, even
 *   while it is still `running`: `const review = await
 *   execution.reviews.create({kind: 'import', title: 'Import from Notion',
 *   drafts: [{source: 'notion'}]})`, and return `reviews: [await
 *   review.reference()]`. The card fills in as planning goes; don't wait for
 *   it or poll `status()`. Tell the user the plan's counts as they are, and
 *   end by asking "Should I kick it off?".
 * - Nothing is written until a person approves the review; a program can't.
 *   If the user says yes, submit it with the `DecideReview` tool (after
 *   `GetReview` for its revision), not from code. While the plan is still
 *   being made it is refused, so say it isn't ready yet. The write starts in
 *   the background, so a `ready` report right after means it is starting.
 * - To check progress later, call `status()`; never `plan()` again, which
 *   replaces the plan.
 * - `cancel()` stops planning or writing; what was imported stays. A plan
 *   that is `ready` but not started is dropped by dismissing its review (on
 *   its card, or `DecideReview` with a dismiss decision), not by `cancel()`.
 *
 * ## Single items and the ledger
 *
 * Stage an item with `track` before creating anything for it, and stop when
 * the outcome says it already exists, was declined, or is being imported.
 * After creating the Macro item yourself, record it with `recordImported`.
 * Import a single Notion page with `importNotionPage`, never by fetching and
 * recreating it.
 */
export class ImportNamespace {
  /** The Notion workspace import. */
  readonly notion: NotionWorkspaceImport;

  /** The Linear workspace import: issues become tasks, their groups projects. */
  readonly linear: TrackerWorkspaceImport;

  /** The Jira Cloud import: issues become tasks, projects and epics projects. */
  readonly jira: TrackerWorkspaceImport;

  constructor(private readonly client: MacroClient) {
    this.notion = new NotionWorkspaceImport(client);
    this.linear = new TrackerWorkspaceImport(client, 'linear');
    this.jira = new TrackerWorkspaceImport(client, 'jira');
  }

  /**
   * The caller's ledger entries, newest first: their staged candidates,
   * running and finished imports (with ones teammates imported into the
   * team), and declined items.
   *
   * @readonly
   */
  async list(
    options: { source?: ImportSource; status?: ImportStatus } = {},
  ): Promise<ImportEntry[]> {
    const { entities } = unwrap(
      await this.client.cognition.listImportEntities({
        query: { source: options.source, status: options.status },
      }),
    );
    return entities.map((record) => ImportEntry.from(this.client, record));
  }

  /**
   * Propose an external item for import, before creating anything for it.
   * The outcome says when it was already imported, declined or is being
   * imported; then do not create it.
   *
   * @write
   * @idempotent
   */
  async track(candidate: ImportCandidate): Promise<TrackedImport> {
    return this.trackAs(candidate, 'staged');
  }

  /**
   * Record that `item` was created in Macro from the external item, so it is
   * not imported again. The ledger stores each source's kind of item: a task
   * for Linear and Jira, a document for Notion and a channel for Slack, and
   * any other handle is refused. An earlier mapping wins: the outcome is then
   * `already_imported` and `entry.item()` is the item recorded first.
   *
   * @write
   * @idempotent
   */
  async recordImported(
    candidate: ImportCandidate,
    item: ImportedItem,
  ): Promise<TrackedImport> {
    const expected = match(candidate.source)
      .with('linear', 'jira', () => ({
        kind: 'task',
        fits: item instanceof Task,
      }))
      .with('notion', () => ({
        kind: 'document',
        fits: item.entityType === 'document' && !(item instanceof Task),
      }))
      .with('slack', () => ({
        kind: 'channel',
        fits: item instanceof Channel,
      }))
      .exhaustive();
    if (!expected.fits)
      throw new MacroError(
        `A ${candidate.source} import is recorded as a ${expected.kind}`,
      );
    return this.trackAs(candidate, 'imported', item);
  }

  /**
   * Import one Notion page as a Macro document through the caller's Notion
   * connection, deduplicated against the ledger. Notion databases are not
   * imported; import a whole workspace through a reviewed import instead.
   *
   * @write
   * @openworld
   */
  async importNotionPage(page: string): Promise<NotionPageImport> {
    const { outcome, entity } = unwrap(
      await this.client.cognition.importNotionPage({ body: { page } }),
    );
    return { outcome, entry: ImportEntry.from(this.client, entity) };
  }

  private async trackAs(
    candidate: ImportCandidate,
    status: 'staged' | 'imported',
    item?: ImportedItem,
  ): Promise<TrackedImport> {
    const { outcome, entity } = unwrap(
      await this.client.cognition.trackImportEntity({
        body: {
          source: candidate.source,
          foreignId: candidate.foreignId,
          status,
          metadata: candidate.metadata,
          entityId: item?.id,
        },
      }),
    );
    return { outcome, entry: ImportEntry.from(this.client, entity) };
  }
}
