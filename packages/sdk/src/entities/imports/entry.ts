import { match } from 'ts-pattern';
import type {
  ImportEntity as ImportEntryRecord,
  ImportKind,
  ImportSource,
  ImportStatus,
} from '../../../generated/cognition/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Channel } from '../channels/channel';
import { Database } from '../databases/database';
import { Document } from '../documents/document';
import { Initiative } from '../initiatives/initiative';
import { Project } from '../projects/project';
import { Task } from '../tasks/task';
import { User } from '../users/user';

/** The Macro item an import became. */
export type ImportedItem =
  | Document
  | Task
  | Channel
  | Database
  | Project
  | Initiative;

/**
 * One external item in the import ledger: a Linear or Jira issue, a Notion
 * page or database, or a Slack channel, from the moment it is proposed
 * (`staged`) through `importing` to `imported` (or `discarded`, declined).
 *
 * @mcp-exclude Built from a ledger listing or tracking response; no id-only reference an MCP call can pass.
 */
export class ImportEntry {
  private constructor(
    private readonly client: MacroClient,
    private readonly record: ImportEntryRecord,
  ) {}

  /** Wrap a ledger row from an import response. */
  static from(client: MacroClient, record: ImportEntryRecord): ImportEntry {
    return new ImportEntry(client, record);
  }

  /** Ledger row id. */
  get id(): string {
    return this.record.id;
  }

  /** The external system the item comes from. */
  get source(): ImportSource {
    return this.record.source;
  }

  /** What the item is in its source system. */
  get kind(): ImportKind {
    return this.record.kind;
  }

  /** The item's stable id in its source system. */
  get foreignId(): string {
    return this.record.foreign_id;
  }

  /** Where the entry is in its lifecycle. */
  get status(): ImportStatus {
    return this.record.status;
  }

  /** What the source said about the item (title, URL, …), by source. */
  get metadata(): unknown {
    return this.record.metadata;
  }

  /** Why the last attempt to import it failed, if one did. */
  get lastError(): string | undefined {
    return this.record.last_error ?? undefined;
  }

  /** When it was first proposed, RFC 3339. */
  get createdAt(): string {
    return this.record.created_at;
  }

  /**
   * Who tracked the item: the caller, or the teammate whose import into the
   * team this is.
   *
   * @readonly
   */
  importedBy(): User {
    return User.byId(this.client, this.record.user_id);
  }

  /**
   * The Macro item the import became; `undefined` until it is imported, or
   * for a kind of item this SDK has no handle for.
   *
   * @readonly
   */
  item(): ImportedItem | undefined {
    const id = this.record.entity_id;
    if (!id) return undefined;
    return match(this.record.entity_type ?? '')
      .with('md', () => Document.byId(this.client, id))
      .with('task', () => Task.byId(this.client, id))
      .with('channel', () => Channel.byId(this.client, id))
      .with('database', () => Database.byId(this.client, id))
      .with('project', () => Project.byId(this.client, id))
      .with('initiative', () => Initiative.byId(this.client, id))
      .otherwise(() => undefined);
  }

  /**
   * Decline this staged candidate for the caller: it is remembered as
   * declined and not proposed again. Only the caller's own staged entries can
   * be declined; declining one again is refused.
   *
   * @destructive
   */
  async decline(): Promise<void> {
    unwrap(
      await this.client.cognition.declineImportEntity({
        path: { id: this.id },
      }),
    );
  }

  /** The ledger row, without the authenticated client. */
  toJSON(): ImportEntryRecord {
    return this.record;
  }
}
