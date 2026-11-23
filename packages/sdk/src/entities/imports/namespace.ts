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
 * The import ledger: the external items (Linear and Jira issues, Notion pages,
 * Slack channels) the caller has proposed for import, imported, or declined,
 * with the team's imports. Check it before copying an item into Macro, so
 * nothing is imported twice.
 *
 * @routing Use when tracking one external item being copied into Macro, checking whether it was already imported, or importing one Notion page; not a whole Notion, Linear or Jira workspace, which goes through a reviewed import.
 *
 * @agent
 * Stage an item with `track` before creating anything for it, and stop when
 * the outcome says it already exists, was declined, or is being imported.
 * After creating the Macro item yourself, record it with `recordImported`.
 * Import a single Notion page with `importNotionPage`, never by fetching and
 * recreating it.
 */
export class ImportNamespace {
  constructor(private readonly client: MacroClient) {}

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
