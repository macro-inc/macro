import type { Harness as HarnessRecord } from '../../../generated/storage/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { Team } from '../teams/team';
import { User } from '../users/user';

/** Who owns a host: a user (private to them) or a team. */
export type HarnessOwner =
  | { type: 'user'; user: User }
  | { type: 'team'; team: Team };

/** A registered host for coding agents. */
export class Harness extends MacroEntity<HarnessRecord> {
  /** Construct a lazy host handle. */
  static byId(client: MacroClient, id: string): Harness {
    return new Harness(client, id);
  }

  /** Seed from a listed host. */
  static from(client: MacroClient, record: HarnessRecord): Harness {
    return new Harness(client, record.id, record);
  }

  protected async fetch(): Promise<HarnessRecord> {
    const record = unwrap(await this.client.storage.listHarnesses()).find(
      (h) => h.id === this.id,
    );
    if (!record)
      throw new MacroNotFoundError(`Harness ${this.id} is unavailable`);
    return record;
  }

  /** Display name. */
  readonly name = this.field('name');

  /** Whether the host is connected. */
  readonly connected = this.field('connected');

  /** Runtime kind. */
  readonly kind = this.field('kind');

  /** The owning user or team. */
  readonly owner = this.mappedField(
    'owner',
    (owner): HarnessOwner =>
      owner.type === 'user'
        ? { type: 'user', user: User.byId(this.client, owner.user_id) }
        : { type: 'team', team: Team.byId(this.client, owner.team_id) },
  );

  /** Whether agents here may bypass permission prompts. */
  readonly allowPermissionBypass = this.field('allow_permission_bypass');

  /**
   * The directory new sessions use when their agent names none, or
   * `undefined` for the workspace in the machine's macrod.toml.
   */
  readonly workspace = this.mappedField(
    'workspace_path',
    (path) => path ?? undefined,
  );

  /**
   * The directories the host reported its sessions may use: its allowed
   * roots and the repositories under them.
   */
  readonly reportedWorkspaces = this.mappedField(
    'reported_workspaces',
    (workspaces) => workspaces ?? [],
  );

  /**
   * Set the directory new sessions use when their agent names none: one of
   * {@link Harness.reportedWorkspaces}, or `undefined` for the workspace in
   * the machine's macrod.toml. Running sessions keep theirs.
   */
  async setWorkspace(path: string | undefined): Promise<void> {
    await this.mutate((c) =>
      c.storage.patchHarness({
        path: { harness_id: this.id },
        body: {
          workspace: path ? { type: 'path', path } : { type: 'local' },
        },
      }),
    );
  }

  /**
   * Allow or forbid agents here to bypass permission prompts. Live sessions
   * pick the change up at their next turn.
   */
  async setPermissionBypass(allowed: boolean): Promise<void> {
    await this.mutate((c) =>
      c.storage.patchHarness({
        path: { harness_id: this.id },
        body: { allow_permission_bypass: allowed },
      }),
    );
  }

  /**
   * Make the host private to the caller. Refused with a 409 `MacroApiError`
   * while agents other people own run on it; its `data.blocking_agents` lists
   * them, to move to another runtime first.
   */
  async makePrivate(): Promise<void> {
    await this.mutate((c) =>
      c.storage.patchHarness({
        path: { harness_id: this.id },
        body: { owner: { type: 'user' } },
      }),
    );
  }

  /**
   * Share the host with a team the caller belongs to. Refused with a 409
   * `MacroApiError` while agents of its current team run on it; its
   * `data.blocking_agents` lists them.
   */
  async shareWithTeam(team: Team): Promise<void> {
    await this.mutate((c) =>
      c.storage.patchHarness({
        path: { harness_id: this.id },
        body: { owner: { type: 'team', team_id: team.id } },
      }),
    );
  }

  /** Rename the host. */
  async rename(name: string): Promise<void> {
    await this.mutate((c) =>
      c.storage.patchHarness({
        path: { harness_id: this.id },
        body: { name },
      }),
    );
  }

  /** Remove the host. */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.storage.deleteHarness({ path: { harness_id: this.id } }),
    );
  }
}
