import type {
  CreateDashboardBody,
  Dashboard as DashboardRecord,
  PatchDashboardPaneBody,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { EntityAccess } from '../sharing/access';
import { User } from '../users/user';

/**
 * A dashboard's view: a dynamic-UI view in the format of the PresentView
 * schema in ExecuteCode's description. Give a widget a stable `id` to patch
 * it later with {@link Dashboard.patch}.
 */
export type DashboardView = CreateDashboardBody['view'];

/** One widget of a {@link DashboardView}. */
export type DashboardWidget = PatchDashboardPaneBody['widget'];

/** One saved version of a dashboard. */
export interface DashboardVersionEntry {
  /** The version; the first save is 1. */
  version: number;
  /** Who saved it. */
  author: User;
  /** When it was saved, as an ISO timestamp. */
  createdAt: string;
}

/** Options for a whole-view save. */
export interface UpdateDashboardOptions {
  /**
   * Fail with a conflict (409) instead of saving when the dashboard is no
   * longer at this version, so an edit made elsewhere is never overwritten.
   */
  expectedVersion?: number;
}

/**
 * A dashboard: a saved, versioned view with an owner and its own grants.
 * Every save is a new version, so a bad edit is one {@link revert} away.
 * Each pane reads as whoever views the dashboard: sharing it shares the
 * layout, never the data its panes show.
 */
export class Dashboard extends MacroEntity<DashboardRecord> {
  /** Who can read and edit this dashboard, and requests for more access. */
  readonly access = new EntityAccess(this.client, 'dashboard', this);

  /** A handle to a dashboard by id. Details load on first access. */
  static byId(client: MacroClient, id: string): Dashboard {
    return new Dashboard(client, id);
  }

  /** Wrap an already-loaded record. */
  static fromRecord(client: MacroClient, record: DashboardRecord): Dashboard {
    return new Dashboard(client, record.id, record);
  }

  protected async fetch(): Promise<DashboardRecord> {
    return unwrap(
      await this.client.storage.getDashboard({ path: { id: this.id } }),
    );
  }

  /** The view's title, when it has one. */
  readonly title = this.field('title');

  /** The current version; every save makes a new one. */
  readonly version = this.field('version');

  /** The current view, checked when it was saved. */
  readonly view = this.mappedField('view', (view) => view as DashboardView);

  /** Who owns it. */
  readonly owner = this.mappedField('ownerId', (id) =>
    User.byId(this.client, id),
  );

  /** Your access: `view`, `edit` or `owner`. */
  readonly accessLevel = this.field('accessLevel');

  /** When the current version was saved, as an ISO timestamp. */
  readonly updatedAt = this.field('updatedAt');

  /**
   * The dashboard's page in the Macro app.
   *
   * @readonly
   */
  webUrl(): string {
    return `${this.client.webAppUrl}/app/dashboard/${this.id}`;
  }

  toJSON() {
    return { ...super.toJSON(), url: this.webUrl() };
  }

  /** Keep the saved record so the next read needs no request. */
  private saved(record: DashboardRecord): this {
    this.detail.set(record);
    return this;
  }

  /**
   * Replace the whole view, as a new version. The view is checked before it
   * is saved; one that does not match the schema, is over 64 KB, or gives two
   * widgets the same `id` throws with what to fix.
   *
   * @write
   */
  async update(
    view: DashboardView,
    options?: UpdateDashboardOptions,
  ): Promise<this> {
    const record = unwrap(
      await this.client.storage.updateDashboard({
        path: { id: this.id },
        body: { view, expectedVersion: options?.expectedVersion ?? null },
      }),
    );
    return this.saved(record);
  }

  /**
   * Replace the one widget whose `id` is `paneId`, at any depth, by `widget`,
   * as a new version; the rest of the view is unchanged. Give `widget` the
   * same `id` to keep the pane patchable.
   *
   * @write
   */
  async patch(
    paneId: string,
    widget: DashboardWidget,
    options?: UpdateDashboardOptions,
  ): Promise<this> {
    const record = unwrap(
      await this.client.storage.patchDashboardPane({
        path: { id: this.id, pane_id: paneId },
        body: { widget, expectedVersion: options?.expectedVersion ?? null },
      }),
    );
    return this.saved(record);
  }

  /**
   * The newest saved versions, at most 100, newest first.
   *
   * @readonly
   */
  async versions(): Promise<DashboardVersionEntry[]> {
    const { versions } = unwrap(
      await this.client.storage.listDashboardVersions({
        path: { id: this.id },
      }),
    );
    return versions.map((entry) => ({
      version: entry.version,
      author: User.byId(this.client, entry.authorId),
      createdAt: entry.createdAt,
    }));
  }

  /**
   * The view an earlier version saved.
   *
   * @readonly
   */
  async viewAt(version: number): Promise<DashboardView> {
    const saved = unwrap(
      await this.client.storage.getDashboardVersion({
        path: { id: this.id, number: version },
      }),
    );
    return saved.view as DashboardView;
  }

  /**
   * Save an earlier version's view as the newest version. Nothing is lost:
   * the versions after it stay in the history.
   *
   * @write
   */
  async revert(version: number): Promise<this> {
    const record = unwrap(
      await this.client.storage.revertDashboard({
        path: { id: this.id, number: version },
      }),
    );
    return this.saved(record);
  }

  /**
   * Delete the dashboard with its history. Only its owner can.
   *
   * @destructive
   */
  async delete(): Promise<void> {
    await this.mutate((client) =>
      client.storage.deleteDashboard({ path: { id: this.id } }),
    );
  }
}
