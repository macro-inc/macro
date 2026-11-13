import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { User } from '../users/user';
import { Dashboard, type DashboardView } from './dashboard';

/**
 * Dashboards: saved, versioned views shown full-page in the app, built from
 * the same widgets as `execution.views.present`.
 *
 * @routing Use when creating, changing or reading a saved dashboard, such as an agent's own home dashboard; not presenting a one-off view in the conversation (`execution.views.present`).
 *
 * @agent
 * ## Dashboards
 *
 * - A dashboard's view has the PresentView schema from ExecuteCode's description. It stores layout and queries, never copied data: use list widgets with a `query` source so a pane reads live, and leave out numbers that go stale.
 * - Give every widget you may change later a short, stable `id` ("running", "inbox"); `dashboard.patch(id, widget)` then replaces just that pane. Ids are unique within a view.
 * - Each save is a new version. To undo a bad edit, `dashboard.versions()` then `dashboard.revert(version)`.
 * - Your own home dashboard is the one people see on your page: `macro.me.setHomeDashboard(dashboard)`. Change the one you have rather than creating another; find it with `macro.me.homeDashboard()`.
 * - Panes read as whoever views the dashboard, so sharing it never shows anyone data they can't already read.
 */
export class DashboardNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to a dashboard by id. Details load on first access. */
  byId(id: string): Dashboard {
    return Dashboard.byId(this.client, id);
  }

  /**
   * Save a view as a new dashboard you own, at version 1. The view is
   * checked first; one that does not match the schema throws with what to fix.
   *
   * @write
   */
  async create(view: DashboardView): Promise<Dashboard> {
    const record = unwrap(
      await this.client.storage.createDashboard({ body: { view } }),
    );
    return Dashboard.fromRecord(this.client, record);
  }

  /**
   * The dashboards you own, most recently saved first, at most 200.
   *
   * @readonly
   */
  async list(): Promise<Dashboard[]> {
    const { dashboards } = unwrap(await this.client.storage.listDashboards());
    return dashboards.map((summary) => Dashboard.byId(this.client, summary.id));
  }

  /**
   * Someone's home dashboard (an agent's page shows it), or `undefined` when
   * they have none or you can't read it.
   *
   * @readonly
   */
  async home(user: User): Promise<Dashboard | undefined> {
    const result = await this.client.storage.getHomeDashboard({
      path: { user_id: user.id },
    });
    if (result.response?.status === 404) return undefined;
    return Dashboard.fromRecord(this.client, unwrap(result));
  }
}
