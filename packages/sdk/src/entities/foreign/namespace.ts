import type {
  GithubAuthorFacet as WireGithubAuthorFacet,
  GithubRepositoryFacet,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { ForeignEntity } from './foreign-entity';

export type { GithubRepositoryFacet };

/** An author among the GitHub pull requests visible to the caller. */
export type GithubAuthorFacet = Omit<WireGithubAuthorFacet, 'login'> & {
  /** The author's most recently synced GitHub login, when known. */
  login?: string;
};

/** Repositories and authors among the GitHub pull requests visible to the caller. */
export interface GithubPullRequestFacets {
  /** Repositories, most pull requests first. */
  repositories: GithubRepositoryFacet[];
  /** Authors, most pull requests first. */
  authors: GithubAuthorFacet[];
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
    foreignEntityId: string,
  ): Promise<ForeignEntity> {
    return ForeignEntity.fromRecord(
      this.client,
      unwrap(
        await this.client.storage.getForeignEntityBySource({
          path: { source, foreign_entity_id: foreignEntityId },
        }),
      ),
    );
  }

  /**
   * Repositories and authors among the GitHub pull requests visible to the
   * authenticated user and their team, each with how many pull requests it
   * covers. A pull request synced for both the user and the team counts once.
   */
  async githubPullRequestFacets(): Promise<GithubPullRequestFacets> {
    const { repositories, authors } = unwrap(
      await this.client.storage.getGithubPullRequestFacets(),
    );
    return {
      repositories,
      authors: authors.map(({ login, ...author }) => ({
        ...author,
        login: login ?? undefined,
      })),
    };
  }
}
