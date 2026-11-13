import type {
  ChangesetDto,
  StoredGithubPullRequest,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';

/** A stored GitHub pull request addressed by its Macro foreign entity. */
export class GithubPullRequest extends MacroEntity<StoredGithubPullRequest> {
  /** Construct a lazy pull request handle. */
  static byId(client: MacroClient, id: string): GithubPullRequest {
    return new GithubPullRequest(client, id);
  }

  protected async fetch(): Promise<StoredGithubPullRequest> {
    return unwrap(
      await this.client.storage.getGithubPullRequest({ path: { id: this.id } }),
    );
  }

  /** Pull request title. */
  readonly title = this.field('title');

  /** GitHub URL. */
  readonly url = this.field('url');

  /** Current state. */
  readonly status = this.field('status');

  /**
   * Whether the pull request is a draft.
   * @readonly
   */
  readonly draft = this.field('draft');

  /**
   * Outstanding review requests, as stable GitHub user IDs.
   * @readonly
   */
  readonly requestedReviewerGithubUserIds = this.field(
    'requestedReviewerGithubUserIds',
  );

  /**
   * Each reviewer's latest submitted review.
   * @readonly
   */
  readonly reviews = this.field('reviews');

  /**
   * The aggregate review decision.
   * @readonly
   */
  readonly reviewDecision = this.field('reviewDecision');

  /**
   * The latest checks on the head commit.
   * @readonly
   */
  readonly checks = this.field('checks');

  /**
   * The GitHub user who merged the pull request, when known.
   * @readonly
   */
  readonly mergedBy = this.field('mergedBy');

  /**
   * The sender of the closing webhook, when known.
   * @readonly
   */
  readonly closedBy = this.field('closedBy');

  /**
   * When GitHub merged the pull request, when known.
   * @readonly
   */
  readonly mergedAt = this.field('mergedAt');

  /**
   * When GitHub closed the pull request, when known.
   * @readonly
   */
  readonly closedAt = this.field('closedAt');

  /**
   * Captured change metadata, when available.
   *
   * @readonly
   */
  async changes(): Promise<{
    changeset?: PullRequestChangeset;
    error?: string;
  }> {
    const result = unwrap(
      await this.client.storage.getGithubPullRequestChanges({
        path: { id: this.id },
      }),
    );
    return {
      changeset: result.changeset
        ? new PullRequestChangeset(this.client, this, result.changeset)
        : undefined,
      error: result.error ?? undefined,
    };
  }
}

/**
 * One captured diff belonging to a pull request.
 *
 * @mcp-exclude Built from a listing record; no id-only reference an MCP call can pass.
 */
export class PullRequestChangeset {
  constructor(
    private readonly client: MacroClient,
    /** Parent pull request. */
    readonly pullRequest: GithubPullRequest,
    /** Captured metadata. */
    readonly record: ChangesetDto,
  ) {}

  /** Captured identity. */
  get id(): string {
    return this.record.id;
  }

  /**
   * Read the captured unified patch.
   *
   * @readonly
   */
  async patch(): Promise<string> {
    return unwrap(
      await this.client.storage.getGithubPullRequestChangesPatch({
        path: { id: this.pullRequest.id },
        query: { changeset: this.id },
      }),
    ).patch;
  }

  /** Serialize captured metadata and parent identity. */
  toJSON() {
    return { pullRequestId: this.pullRequest.id, ...this.record };
  }
}
