import type { DatabaseWebhookResponse } from '../../../generated/storage/types.gen';
import type { User } from '../users/user';
import type { DatabaseTable } from './table';

/**
 * A webhook of a {@link DatabaseTable}: a secret URL that anyone holding it
 * can POST JSON to, each object becoming a row, written with the access of
 * the user who created it. Its token is shown only when it is created; see
 * {@link Database.createWebhook}.
 */
export class DatabaseWebhook {
  private constructor(
    /** The table its calls insert rows into. */
    readonly table: DatabaseTable,
    /** Identifier of the webhook. */
    readonly id: string,
    /** Who created it; its calls write with their access. */
    readonly createdBy: User,
    private readonly record: DatabaseWebhookResponse,
  ) {}

  /** A handle from the record the API answered. */
  static fromRecord(
    table: DatabaseTable,
    createdBy: User,
    record: DatabaseWebhookResponse,
  ): DatabaseWebhook {
    return new DatabaseWebhook(table, record.id, createdBy, record);
  }

  /** The token's first characters, to tell webhooks apart without the secret. */
  get tokenPrefix(): string {
    return this.record.tokenPrefix;
  }

  /** When it was created. */
  get createdAt(): string {
    return this.record.createdAt;
  }

  /** Delete the webhook; its URL stops working. */
  delete(): Promise<void> {
    return this.table.database.deleteWebhook(this);
  }

  toJSON(): { id: string; tableId: string; tokenPrefix: string } {
    return {
      id: this.id,
      tableId: this.table.id,
      tokenPrefix: this.tokenPrefix,
    };
  }
}
