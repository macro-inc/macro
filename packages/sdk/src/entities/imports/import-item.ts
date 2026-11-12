import { match } from 'ts-pattern';
import type {
  ImportEntity,
  ImportOutcome,
  ImportSource,
  ImportStatus,
} from '../../../generated/cognition/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Channel } from '../channels/channel';
import { Database } from '../databases/database';
import { Document } from '../documents/document';
import { MacroEntity } from '../entity';
import { Initiative } from '../initiatives/initiative';
import { Project } from '../projects/project';
import { Task } from '../tasks/task';
import { User } from '../users/user';

/** The Macro item an external item became once imported. */
export type ImportedEntity =
  | Document
  | Task
  | Channel
  | Database
  | Project
  | Initiative;

/** What became of a request to track or import an item. */
export interface ImportResult {
  /**
   * `staged` or `imported` when the request did what it asked;
   * `already_imported` / `already_imported_by_teammate` when a copy exists
   * (point the user at `item.entity()`, never create a duplicate);
   * `previously_declined` when the user declined it before (leave it);
   * `import_in_progress` when an import is already copying it in.
   */
  outcome: ImportOutcome;
  /** The ledger row behind the outcome. */
  item: ImportItem;
}

/** Filters for {@link ImportItem.list}. */
export interface ImportItemFilters {
  /** Only items from this source. */
  source?: ImportSource;
  /** Only items in this state. */
  status?: ImportStatus;
}

/** What to record about an external item. */
export interface TrackedItem {
  /** The external system the item comes from. */
  source: ImportSource;
  /**
   * Its stable id there: a Linear identifier such as `ENG-142`, a Notion page
   * URL or id, or a Slack channel id such as `C0123456789`.
   */
  foreignId: string;
  /**
   * What the item is. Linear: `{identifier, title, description?, status?,
   * priority?, assignee?, assignee_email?, url?}`. Notion: `{title, url?,
   * summary?}`, never the page's content. Slack: `{name, channel_id?,
   * purpose?, participants?: [{name, email?}]}`.
   */
  metadata: { [key: string]: unknown };
}

/**
 * One external item (a Linear issue, Notion page or Slack channel) in the
 * import ledger, from staged candidate to the Macro item it became.
 */
export class ImportItem extends MacroEntity<ImportEntity> {
  private constructor(client: MacroClient, id: string, seed?: ImportEntity) {
    super(client, id, seed);
  }

  /** A handle to a ledger row by id. Details load on first access. */
  static byId(client: MacroClient, id: string): ImportItem {
    return new ImportItem(client, id);
  }

  /** A handle seeded with a row the API already returned. */
  static fromRow(client: MacroClient, row: ImportEntity): ImportItem {
    return new ImportItem(client, row.id, row);
  }

  /** The user's ledger, newest first, including teammates' team imports. */
  static async list(
    client: MacroClient,
    filters: ImportItemFilters = {},
  ): Promise<ImportItem[]> {
    const rows = unwrap(
      await client.cognition.listEntitiesHandler({
        query: { source: filters.source, status: filters.status },
      }),
    );
    return rows.map((row) => ImportItem.fromRow(client, row));
  }

  /** Stage an item, or record the Macro item already made from it. */
  static async track(
    client: MacroClient,
    item: TrackedItem,
    entity?: ImportedEntity,
  ): Promise<ImportResult> {
    const result = unwrap(
      await client.cognition.trackEntityHandler({
        body: {
          source: item.source,
          foreignId: item.foreignId,
          metadata: item.metadata,
          entityId: entity?.id,
        },
      }),
    );
    return {
      outcome: result.outcome,
      item: ImportItem.fromRow(client, result.entity),
    };
  }

  /** Import one Notion page as a Macro document. */
  static async importNotionPage(
    client: MacroClient,
    pageUrl: string,
  ): Promise<ImportResult> {
    const result = unwrap(
      await client.cognition.importNotionPageHandler({ body: { pageUrl } }),
    );
    return {
      outcome: result.outcome,
      item: ImportItem.fromRow(client, result.entity),
    };
  }

  protected async fetch(): Promise<ImportEntity> {
    const rows = unwrap(
      await this.client.cognition.listEntitiesHandler({ query: {} }),
    );
    const row = rows.find((candidate) => candidate.id === this.id);
    if (!row) throw new MacroNotFoundError(`import item ${this.id} not found`);
    return row;
  }

  /** The external system the item comes from. */
  readonly source = this.field('source');

  /** What the item is in its source: issue, page, database, channel… */
  readonly kind = this.field('kind');

  /** The item's stable id in its source. */
  readonly foreignId = this.field('foreign_id');

  /** `staged`, `importing`, `imported` or `discarded` (declined). */
  readonly status = this.field('status');

  /** What the item is, as recorded when it was staged (title, URL…). */
  readonly metadata = this.field('metadata');

  /** Why the last import attempt failed, when one did. */
  readonly lastError = this.field('last_error');

  /** When the item was first staged, as an ISO timestamp. */
  readonly createdAt = this.field('created_at');

  /**
   * The user who staged or imported it: a teammate for a team import.
   * @readonly
   */
  async importedBy(): Promise<User> {
    return User.byId(this.client, (await this.detail.get()).user_id);
  }

  /**
   * The Macro item it became, once imported.
   * @readonly
   */
  async entity(): Promise<ImportedEntity | undefined> {
    const { entity_id: id, entity_type: type } = await this.detail.get();
    if (!id || !type) return undefined;

    return match(type)
      .with('md', () => Document.byId(this.client, id))
      .with('task', () => Task.byId(this.client, id))
      .with('channel', () => Channel.byId(this.client, id))
      .with('database', () => Database.byId(this.client, id))
      .with('project', () => Project.byId(this.client, id))
      .with('initiative', () => Initiative.byId(this.client, id))
      .otherwise(() => {
        throw new Error(`import item ${this.id} became an unknown ${type}`);
      });
  }

  /**
   * Decline this staged candidate on the user's behalf: it is remembered and
   * not proposed again. Only the user's own staged items can be declined.
   * @write
   * @idempotent
   */
  async decline(): Promise<void> {
    await this.mutate((client) =>
      client.cognition.discardEntityHandler({ path: { id: this.id } }),
    );
  }
}
