import type { MacroClient } from '../../utils/client';
import type { ForeignEntity } from '../foreign/foreign-entity';
import { GithubPullRequest } from './pull-request';

/**
 * GitHub pull request snapshots and captured diffs.
 *
 * @routing Use when reading a GitHub pull request's stored snapshot or diff; not changing code, which a coding agent does.
 */
export class GithubPullRequestNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Construct from a Macro foreign entity's identity. */
  byId(id: string): GithubPullRequest {
    return GithubPullRequest.byId(this.client, id);
  }

  /**
   * Resolve a foreign entity as a pull request.
   *
   * @readonly
   */
  forEntity(entity: ForeignEntity): GithubPullRequest {
    return GithubPullRequest.byId(this.client, entity.id);
  }
}
