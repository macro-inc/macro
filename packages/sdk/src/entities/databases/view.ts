import type {
  CardPosition,
  DatabaseView as DatabaseViewRecord,
  ViewLayout,
  ViewQuery,
} from '../../../generated/storage/types.gen';
import { MacroNotFoundError } from '../../utils';
import type { DatabaseTable } from './table';

/**
 * One view of a {@link DatabaseTable}: which of its rows to show, in what
 * order, drawn as a table or a board.
 *
 * A view is not an entity of its own — it is owned and shared as part of its
 * database. The handle resolves through the database's schema, so a fresh
 * read after a write sees the new value. Views are created, changed, and
 * reordered with ops; see {@link Database.applyOps}.
 */
export class DatabaseView {
  private constructor(
    /** The table this view shows. */
    readonly table: DatabaseTable,
    /** Identifier of the view. */
    readonly id: string,
  ) {}

  /** A handle to a view by id, within a table. Details load on first access. */
  static byId(table: DatabaseTable, id: string): DatabaseView {
    return new DatabaseView(table, id);
  }

  /** The view's record as the API returns it. */
  async detail(): Promise<DatabaseViewRecord> {
    const { views } = await this.table.detail();
    const found = views.find((view) => view.id === this.id);
    if (!found) {
      throw new MacroNotFoundError(
        `view ${this.id} is not on table ${this.table.id}`,
      );
    }
    return found;
  }

  /** The view's name, unique among its table's views ignoring case. */
  async name(): Promise<string> {
    return (await this.detail()).name;
  }

  /** The view's fractional index within its table's views. */
  async position(): Promise<string> {
    return (await this.detail()).position;
  }

  /** How the view draws its rows: a table, or a board grouped by a column. */
  async layout(): Promise<ViewLayout> {
    return (await this.detail()).layout;
  }

  /** Which rows the view shows, and in what order. */
  async query(): Promise<ViewQuery> {
    return (await this.detail()).query;
  }

  /**
   * Where a board's cards sit: each placed card's lane and its key there.
   * Cards without a place show after the placed ones of their lane, oldest
   * first.
   */
  positions(): Promise<CardPosition[]> {
    return this.table.database.viewPositions(this);
  }

  toJSON(): { id: string; tableId: string } {
    return { id: this.id, tableId: this.table.id };
  }
}
