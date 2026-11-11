import type { SavedViewDefinition } from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { Team } from '../teams/team';
import { User } from '../users/user';

/**
 * A saved view's configuration. Its shape belongs to the app surface that
 * shows it, named by `kind` (`email`, `task`) and versioned by `version`; see
 * `docs/design/saved-views.md` for each kind's filters.
 */
export type SavedViewConfig = Record<string, unknown> & {
  kind: string;
  version: number;
};

/**
 * A saved view: a named, reusable filter definition (not a snapshot of what
 * it matches) shown in the app's sidebar for its kind, such as Email.
 *
 * Writes are guarded by the revision this handle last saw, so a stale handle
 * fails with a conflict ({@link MacroApiError} with status 409) instead of
 * overwriting an edit made elsewhere; reload it with {@link refresh} and retry.
 */
export class SavedView extends MacroEntity<SavedViewDefinition> {
  private constructor(
    client: MacroClient,
    id: string,
    seed?: SavedViewDefinition,
  ) {
    super(client, id, seed);
  }

  protected async fetch(): Promise<SavedViewDefinition> {
    return unwrap(
      await this.client.storage.getSavedViewDefinition({
        path: { saved_view_id: this.id },
      }),
    );
  }

  /** A handle to a saved view by id. Details load on first access. */
  static byId(client: MacroClient, id: string): SavedView {
    return new SavedView(client, id);
  }

  /** Wrap an already-loaded record. */
  static fromRecord(
    client: MacroClient,
    record: SavedViewDefinition,
  ): SavedView {
    return new SavedView(client, record.id, record);
  }

  /** Create a saved view, private unless shared with a team the caller belongs to. */
  static async create(
    client: MacroClient,
    opts: { name: string; config: SavedViewConfig; team?: Team },
  ): Promise<SavedView> {
    const record = unwrap(
      await client.storage.createSavedViewDefinition({
        body: {
          name: opts.name,
          config: opts.config,
          sharedTeamId: opts.team?.id ?? null,
        },
      }),
    );
    return SavedView.fromRecord(client, record);
  }

  /** The display name. */
  readonly name = this.field('name');

  /** The configuration, interpreted by the app surface of its `kind`. */
  readonly config = this.mappedField(
    'config',
    (config) => config as SavedViewConfig,
  );

  /** The app surface that shows this view, such as `email` or `task`. */
  readonly kind = this.mappedField(
    'config',
    (config) => (config as Partial<SavedViewConfig>).kind,
  );

  /** The user who owns and can edit this view. */
  readonly owner = this.mappedField('ownerId', (id) =>
    User.byId(this.client, id),
  );

  /** The team the view is shared with, or `undefined` when it is private. */
  readonly team = this.mappedField('sharedTeamId', (id) =>
    id === undefined ? undefined : Team.byId(this.client, id),
  );

  /** The revision writes are checked against; each successful write advances it. */
  readonly revision = this.field('revision');

  /** When the view was created. */
  readonly createdAt = this.field('createdAt');

  /** When the view was last changed. */
  readonly updatedAt = this.field('updatedAt');

  /**
   * Reload the view, picking up its current revision.
   *
   * @readonly
   */
  async refresh(): Promise<this> {
    this.detail.set(await this.fetch());
    return this;
  }

  /**
   * Change the name, replace the configuration, or change sharing: a `team`
   * shares the view with it and `null` makes it private; omitted fields are
   * kept. Only the owner can edit.
   *
   * @write
   * @idempotent
   */
  async edit(changes: {
    name?: string;
    config?: SavedViewConfig;
    team?: Team | null;
  }): Promise<void> {
    const { revision } = await this.detail.get();
    const record = unwrap(
      await this.client.storage.updateSavedViewDefinition({
        path: { saved_view_id: this.id },
        body: {
          expectedRevision: revision,
          name: changes.name,
          config: changes.config,
          sharing:
            changes.team === undefined
              ? undefined
              : { teamId: changes.team?.id ?? null },
        },
      }),
    );
    // The response's revision guards this handle's next write.
    this.detail.set(record);
  }

  /**
   * Delete the view for its owner and anyone it is shared with. Only the owner can delete.
   *
   * @destructive
   * @idempotent
   */
  async remove(): Promise<void> {
    const { revision } = await this.detail.get();
    await this.mutate((client) =>
      client.storage.deleteSavedViewDefinition({
        path: { saved_view_id: this.id },
        query: { expectedRevision: revision },
      }),
    );
  }
}
