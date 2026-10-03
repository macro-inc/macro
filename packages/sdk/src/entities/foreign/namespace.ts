import type {
  GithubRepositoryFacet,
  GithubLabelFacet as WireGithubLabelFacet,
  GithubUserFacet as WireGithubUserFacet,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { ForeignEntity } from './foreign-entity';

export type { GithubRepositoryFacet };

/** A GitHub user among the pull requests visible to the caller, as an author or an assignee. */
export type GithubUserFacet = Omit<WireGithubUserFacet, 'login'> & {
  /** The user's most recently synced GitHub login, when known. */
  login?: string;
};

/** A label among the GitHub pull requests visible to the caller. */
export type GithubLabelFacet = Omit<WireGithubLabelFacet, 'color'> & {
  /** The label's most recently synced color, as six hex digits without `#`. */
  color?: string;
};

/**
 * Repositories, authors, assignees, and labels among the GitHub pull requests
 * visible to the caller.
 */
export interface GithubPullRequestFacets {
  /** Repositories, most pull requests first. */
  repositories: GithubRepositoryFacet[];
  /** Authors, most pull requests first. */
  authors: GithubUserFacet[];
  /** Assignees, most pull requests first. */
  assignees: GithubUserFacet[];
  /** Labels, most pull requests first. */
  labels: GithubLabelFacet[];
}

function withoutNullLogin({
  login,
  ...user
}: WireGithubUserFacet): GithubUserFacet {
  return { ...user, login: login ?? undefined };
}

export class ForeignEntityNamespace {
  constructor(private readonly client: MacroClient) {}

  byId(id: string): ForeignEntity {
    return ForeignEntity.byId(this.client, id);
  }

  /**
   * Look a foreign entity up by the identifier its source system assigned.
   *
   * `foreignEntityId` may contain slashes — sources store them inside the
   * identifier, for example `owner/repo/pull/12`.
   */
  async bySource(
    source: string,
    foreignEntityId: string
  ): Promise<ForeignEntity> {
    return ForeignEntity.fromRecord(
      this.client,
      unwrap(
        await this.client.storage.getForeignEntityBySource({
          path: { source, foreign_entity_id: foreignEntityId },
        })
      )
    );
  }

  /**
   * Repositories, authors, assignees, and labels among the GitHub pull
   * requests visible to the authenticated user and their team, each with how
   * many pull requests it covers. A pull request visible to both the user and
   * the team counts once.
   */
  async githubPullRequestFacets(): Promise<GithubPullRequestFacets> {
    const { repositories, authors, assignees, labels } = unwrap(
      await this.client.storage.getGithubPullRequestFacets()
    );
    return {
      repositories,
      authors: authors.map(withoutNullLogin),
      assignees: assignees.map(withoutNullLogin),
      labels: labels.map(({ color, ...label }) => ({
        ...label,
        color: color ?? undefined,
      })),
    };
  }
}
