import type { ImportReviewSource } from '../../../generated/agent-reviews';
import type {
  NotionImportReport,
  NotionSharing,
} from '../../../generated/cognition/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

/** Workspaces imported through a reviewed plan. */
export type WorkspaceImportSource = ImportReviewSource;

/**
 * Who sees what an import writes: `team` shares everything with the user's
 * team, `personal` keeps it to them, `ai` decides per page or group.
 */
export type ImportSharing = NotionSharing;

/** Where a workspace import stands: its run status and exact plan counts. */
export type WorkspaceImportReport = NotionImportReport;

/** Options for {@link WorkspaceImport.plan}. */
export interface WorkspacePlanOptions {
  /**
   * Who sees the import, as the user chose. Required for a user on a team;
   * leave it out until they answer. A user without a team always gets a
   * personal import.
   */
  sharing?: ImportSharing;
}

/** Options for {@link NotionWorkspaceImport.plan}. */
export interface NotionPlanOptions extends WorkspacePlanOptions {
  /**
   * Notion page or database URLs (or ids) to import, each with everything
   * under it. Leave out to plan everything the connection can see.
   */
  roots?: string[];
}

/**
 * The user's import of one connected workspace: plan it and present the plan
 * as an import review. The write starts only when a person approves that
 * review, on its card or through `DecideReview`; a program never can.
 */
export abstract class WorkspaceImport {
  constructor(
    protected readonly client: MacroClient,
    /** The workspace this import reads. */
    readonly source: WorkspaceImportSource,
  ) {}

  /**
   * Read the workspace and stage a plan, replacing any earlier one; nothing
   * is written. Answers within seconds, usually while planning still runs
   * (`status: 'running'`): present the review at once, don't wait or poll.
   * Throws a 409 `MacroApiError` with `data.code` `sharing_required` when the
   * user is on a team and `sharing` is missing (ask them). A source that isn't
   * connected comes back as a `failed` report whose `error` says so (or a 409
   * `not_connected`): offer to connect it instead of presenting a review.
   * Never call it to check progress: it replaces the plan; use `status()`.
   * @write
   * @openworld
   */
  async plan(
    options: WorkspacePlanOptions = {},
  ): Promise<WorkspaceImportReport> {
    return this.requestPlan({ sharing: options.sharing });
  }

  /**
   * Where planning or writing stands; never call it in a loop.
   * @readonly
   */
  async status(): Promise<WorkspaceImportReport> {
    return unwrap(
      await this.client.cognition.workspaceReportHandler({
        path: { source: this.source },
      }),
    );
  }

  /**
   * Stop planning or writing; what is already imported stays.
   * @destructive
   * @idempotent
   */
  async cancel(): Promise<WorkspaceImportReport> {
    return unwrap(
      await this.client.cognition.cancelWorkspaceHandler({
        path: { source: this.source },
      }),
    );
  }

  protected async requestPlan(body: {
    sharing?: ImportSharing;
    roots?: string[];
  }): Promise<WorkspaceImportReport> {
    return unwrap(
      await this.client.cognition.planWorkspaceHandler({
        path: { source: this.source },
        body,
      }),
    );
  }
}

/** An issue tracker workspace this SDK imports. */
export type TrackerImportSource = Exclude<WorkspaceImportSource, 'notion'>;

/** A Linear or Jira workspace import: issues become tasks, groups projects. */
export class TrackerWorkspaceImport extends WorkspaceImport {
  constructor(client: MacroClient, source: TrackerImportSource) {
    super(client, source);
  }
}

/** The Notion workspace import, which can be narrowed to some pages. */
export class NotionWorkspaceImport extends WorkspaceImport {
  constructor(client: MacroClient) {
    super(client, 'notion');
  }

  /**
   * Plan importing the Notion workspace, or the pages and databases in
   * `roots` with everything under them; see {@link WorkspaceImport.plan}.
   * @write
   * @openworld
   */
  override async plan(
    options: NotionPlanOptions = {},
  ): Promise<WorkspaceImportReport> {
    return this.requestPlan({ sharing: options.sharing, roots: options.roots });
  }
}
