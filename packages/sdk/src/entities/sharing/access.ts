import type {
  AccessLevel,
  AccessRequest as RequestRecord,
  ResolveRequest,
  ShareEntityType,
} from '../../../generated/storage/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { User } from '../users/user';

/** Access requests and direct grants scoped to a shareable entity. */
export class EntityAccess {
  constructor(
    private readonly client: MacroClient,
    private readonly entityType: ShareEntityType,
    private readonly entity: { readonly id: string },
  ) {}

  private get path() {
    return { entity_type: this.entityType, entity_id: this.entity.id };
  }

  /** A page of access requests, including the caller's own request and review rights. */
  async state(offset?: number) {
    const state = unwrap(
      await this.client.storage.accessRequestsState({
        path: this.path,
        query: { offset },
      }),
    );
    return {
      accessLevel: state.accessLevel ?? undefined,
      canReview: state.canReview,
      owner: state.owner ? User.byId(this.client, state.owner) : undefined,
      pendingCount: state.pendingCount,
      supportedLevels: state.supportedLevels,
      nextOffset: state.nextOffset ?? undefined,
      mine: state.mine
        ? AccessRequest.from(this.client, this, state.mine)
        : undefined,
      requests: state.requests.map((r) =>
        AccessRequest.from(this.client, this, r),
      ),
    };
  }

  /** Request access, optionally naming the revision of an earlier request. */
  async submit(
    requestedLevel: AccessLevel,
    revision?: number,
  ): Promise<AccessRequest> {
    return AccessRequest.from(
      this.client,
      this,
      unwrap(
        await this.client.storage.accessRequestsSubmit({
          path: this.path,
          body: { requestedLevel, revision },
        }),
      ),
    );
  }

  /** Cancel the caller's own request at its observed revision. */
  async cancel(revision: number): Promise<void> {
    unwrap(
      await this.client.storage.accessRequestsCancel({
        path: this.path,
        query: { revision },
      }),
    );
  }

  /** Direct grants expressed as user handles. */
  async direct() {
    return unwrap(
      await this.client.storage.accessRequestsDirect({ path: this.path }),
    ).map((g) => ({
      user: User.byId(this.client, g.userId),
      accessLevel: g.accessLevel,
    }));
  }

  /** Grant direct access, or remove it by omitting the access level. */
  async grant(user: User, accessLevel?: AccessLevel): Promise<void> {
    unwrap(
      await this.client.storage.accessRequestsSetDirect({
        path: { ...this.path, user_id: user.id },
        body: { accessLevel },
      }),
    );
  }

  /** Remove one user's direct grant. */
  async remove(user: User): Promise<void> {
    unwrap(
      await this.client.storage.accessRequestsRemoveDirect({
        path: { ...this.path, user_id: user.id },
      }),
    );
  }

  /** Resolve a request belonging to this entity at an observed revision. */
  async resolve(
    request: AccessRequest,
    resolution: ResolveRequest,
  ): Promise<RequestRecord> {
    const owner = request.access.toJSON();
    if (
      owner.entity_type !== this.entityType ||
      owner.entity_id !== this.entity.id
    )
      throw new Error('Access request belongs to another entity');
    return unwrap(
      await this.client.storage.accessRequestsResolve({
        path: { ...this.path, request_id: request.id },
        body: resolution,
      }),
    );
  }

  /** Serialize the entity reference without credentials. */
  toJSON() {
    return this.path;
  }
}

/** One access request; resolutions preserve optimistic concurrency. */
export class AccessRequest extends MacroEntity<RequestRecord> {
  private resolvedRecord?: RequestRecord;

  private constructor(
    client: MacroClient,
    /** Entity access surface owning the request. */
    readonly access: EntityAccess,
    record: RequestRecord,
  ) {
    super(client, record.id, record);
  }

  /** Seed a request from a state or submission response. */
  static from(
    client: MacroClient,
    access: EntityAccess,
    record: RequestRecord,
  ): AccessRequest {
    return new AccessRequest(client, access, record);
  }

  protected async fetch(): Promise<RequestRecord> {
    if (this.resolvedRecord) return this.resolvedRecord;
    let offset: number | undefined;
    do {
      const state = await this.access.state(offset);
      const found = [state.mine, ...state.requests].find(
        (r) => r?.id === this.id,
      );
      if (found) return found.detail.get();
      offset = state.nextOffset;
    } while (offset !== undefined);
    throw new MacroNotFoundError(`Access request ${this.id} is unavailable`);
  }

  /** Request revision. */
  readonly revision = this.field('revision');

  /** Current request state. */
  readonly status = this.field('status');

  /** Requested access. */
  readonly requestedLevel = this.field('requestedLevel');

  /** Requesting user. */
  readonly requester = this.mappedField('requesterId', (id) =>
    User.byId(this.client, id),
  );

  /** Approve with an access level, or decline by omitting it. */
  async resolve(grantedLevel?: AccessLevel): Promise<void> {
    this.resolvedRecord = await this.access.resolve(this, {
      revision: await this.revision(),
      grantedLevel,
    });
    this.detail.clear();
  }
}
