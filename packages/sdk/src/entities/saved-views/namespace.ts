import { paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { Team } from '../teams/team';
import { SavedView, type SavedViewConfig } from './saved-view';

/** The most saved views one list request returns. */
const PAGE_SIZE = 50;

/**
 * Saved views: named filter definitions the app shows in a surface's sidebar,
 * such as Email. Each user orders the views they can see for themselves.
 *
 * @routing Use when creating, editing, reordering or removing saved views, the named filters in the Email or Tasks sidebar; not favorites or pins.
 */
export class SavedViewsNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to a saved view by id. Details load on first access. */
  byId(id: string): SavedView {
    return SavedView.byId(this.client, id);
  }

  /**
   * Create a saved view; `config.kind` names the app surface that shows it.
   *
   * An Email view (shown in Email's sidebar) has config
   * `{ kind: 'email', version: 1, filters }`, with every one of these filters:
   * `inboxIds` (inbox ids; empty for every inbox), `participants`
   * (`{ type: 'address', email }` or `{ type: 'domain', domain }`, any of
   * which matches), `participantFields` (which of `from`, `to`, `cc`, `bcc`
   * they match in), `subject` (words, any of which matches), `starred`,
   * `attachments` (`attachment-pdf`, `attachment-image`,
   * `attachment-document`), `calendarInvite`, and `tags` (`[]`); and
   * optionally `importance` (`signal` or `noise`), `read` (`unread` or
   * `read`), `done` (`not-done` or `done`) and `receivedWithinDays` (1, 7,
   * 30 or 90). Separate filters must all match.
   *
   * @write
   */
  create(opts: {
    name: string;
    config: SavedViewConfig;
    /** Share with this team, which you must belong to; private when omitted. */
    team?: Team;
  }): Promise<SavedView> {
    return SavedView.create(this.client, opts);
  }

  /**
   * The saved views you can see, in your own order, auto-paginated: placed
   * views first, then by creation time. Each handle already holds its record.
   *
   * @readonly
   */
  list(opts?: {
    /** Only views of this kind, such as `email`. */
    kind?: string;
  }): AsyncGenerator<SavedView> {
    return paginate(async (after?: string) => {
      const page = unwrap(
        await this.client.storage.listSavedViewDefinitions({
          query: { kind: opts?.kind, first: PAGE_SIZE, after },
        }),
      );
      return {
        items: page.views.map((record) =>
          SavedView.fromRecord(this.client, record),
        ),
        nextCursor: page.nextCursor,
      };
    });
  }

  /**
   * Set your own order of one kind's views: `views` first, in the order
   * given, and the rest after them by creation time. Returns the views in
   * their new order; their definitions are unchanged.
   *
   * @write
   * @idempotent
   */
  async reorder(kind: string, views: SavedView[]): Promise<SavedView[]> {
    const records = unwrap(
      await this.client.storage.reorderSavedViewDefinitions({
        body: { kind, ids: views.map((view) => view.id) },
      }),
    );
    return records.map((record) => SavedView.fromRecord(this.client, record));
  }
}
