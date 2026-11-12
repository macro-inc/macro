import type { FoldedMessage } from '../../../generated/agent-fold';
import type {
  AgentAction,
  AgentMode,
  AgentSessionChangesResponse,
  AgentSessionLogResponse,
  AgentSessionResponse,
  AgentUpdateKind,
  ArchiveCause,
  AutoArchivePreferencesBody,
  CodingPreferencesBody,
  ControlResponse,
  PromptAttachment,
  PullRequestLinkSource,
  SandboxSize,
  SessionBot,
  WorkRegistrationResponse,
} from '../../../generated/agent-harness/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { Agent } from '../agents/agent';
import { MacroEntity } from '../entity';
import { EntityAccess } from '../sharing/access';
import {
  type SharePermissionOptions,
  sharePermissionBody,
} from '../sharing/permissions';
import { Task } from '../tasks/task';
import { User } from '../users/user';
import {
  type AgentActivityOptions,
  AgentInvocation,
  sessionActivity,
} from './activity';
import { CodeExecution } from './code-execution';
import { type SessionOrigin, sessionOrigin } from './origin';
import { QueuedAction } from './queued-action';
import { type CreateReviewOptions, SessionReview } from './review';
import { ToolApproval } from './tool-approval';
import { presentView, type SessionView } from './view';

export type { ArchiveCause };

/**
 * One session's auto-archive choices. A trigger left `undefined` follows the
 * owner's default.
 */
export type AutoArchiveOverrides = {
  /** Archive once every linked pull request is closed and at least one merged. */
  onPullRequestMerged?: boolean;
  /** Archive once the runtime session backing it is deliberately closed. */
  onRuntimeClosed?: boolean;
};

/** A session's auto-archive settings, and when a trigger archived it. */
export type SessionAutoArchive = {
  /** The session's own choices. */
  overrides: AutoArchiveOverrides;
  /** The owner's defaults, which apply where the session has no choice. */
  defaults: AutoArchivePreferencesBody;
  /**
   * When a trigger first archived the session, if one did. It stays after the
   * session is unarchived, since a session archives itself at most once.
   */
  autoArchivedAt?: string;
};

/** A session's history folded into readable messages, oldest first. */
export type FoldedAgentSessionLog = {
  /** The agent that sent every agent message. */
  bot: SessionBot;
  /**
   * Prompts and replies with their tool calls, results, plans, permission
   * requests and how each turn ended.
   */
  messages: FoldedMessage[];
};

/** A GitHub pull request linked to a session. */
/** An agent session an account registered as its work. */
export type RegisteredWork = {
  /** The session registered. */
  session: AgentSession;
  /** The account whose work this is. */
  account: User;
  /** When the account registered it. */
  registeredAt: string;
};

export type SessionPullRequest = {
  /** The pull request's `owner/repo/pull/number` key. */
  githubKey: string;
  /** The pull request's GitHub URL. */
  url: string;
  /** Whether the session's agent opened it or a person linked it. */
  source: PullRequestLinkSource;
  /** Who linked it, for pull requests a person linked. */
  linkedBy?: User;
  /** When it was linked. */
  createdAt: string;
};

/** A request a session is waiting on its owner to answer, or a session gone quiet. */
export type AgentSessionUpdate = {
  /** The session. */
  session: AgentSession;
  /** The session's name. */
  sessionName: string;
  /** The runtime the session runs on. */
  harness: string;
  /** The session's pull request, if it has one. */
  pullRequestUrl?: string;
  /**
   * What the session waits for: `permission` to run a tool, an `elicitation`
   * question, a held `tool_approval`, or `stalled` with no activity for over
   * 20 minutes.
   */
  kind: AgentUpdateKind;
  /** What is asked, or why the session looks stalled. */
  summary: string;
  /** When the request was made, or the session's last activity. */
  since: string;
  /** The choices a permission request offers; empty for other kinds. */
  options: string[];
};

/** The caller's sessions waiting for them, newest activity first. */
export type AgentSessionUpdates = {
  /** One entry per pending request or stalled session. */
  items: AgentSessionUpdate[];
  /** Whether sessions beyond the 25 most recent were left out. */
  truncated: boolean;
  /** Says what was left out, when truncated. */
  truncationNotice?: string;
};

/** A tool call the session's runtime holds until its owner answers. */
export type PendingToolApproval = {
  /** Answer it with {@link ToolApproval.answer}. */
  approval: ToolApproval;
  /** What a person calls the server the tool is on. */
  serverName: string;
  /** The tool called. */
  toolName: string;
  /** What it was called with. */
  arguments: unknown;
  /** Who prompted the turn; absent for a bot on nobody's behalf. */
  requestedBy?: User;
};

/** The task a session is linked to. */
export type LinkedTask = {
  /** The task. */
  task: Task;
  /** Put this in the pull request description so GitHub activity reaches the task. */
  reference: string;
  /** The session's pull request, now linked to the task, if it has one. */
  pullRequestUrl?: string;
};

/** A GitHub repository the caller can point a managed session at. */
export type SelectableRepository = {
  /** The canonical `https://github.com/owner/name` URL, as `createManaged` takes it. */
  url: string;
  /**
   * The branch its clones check out, and where a session starts unless
   * `createManaged` names another. Absent for a repository with no commits.
   */
  defaultBranch?: string;
};

/** What a managed session is created with. */
export type CreateManagedSessionOptions = {
  /**
   * Persona the session runs as, from {@link AgentNamespace.coding} or
   * {@link AgentNamespace.list}. The caller must be able to use it. Omitted, the
   * deployment's default coding persona, or Cursor when `repoUrl` is set.
   * Its harness, instructions and model apply unless `instructions` or
   * `model` override them.
   */
  agent?: Agent;
  /** First prompt to deliver once the session is running. */
  prompt?: string;
  /**
   * Instructions the session's runtime works under, fixed for its life.
   * Outranks the persona's when both are set.
   */
  instructions?: string;
  /**
   * The model the session runs on, instead of its persona's. The session's
   * model from creation, read back as {@link AgentSession.model}.
   */
  model?: string;
  /**
   * The repository the session works on, as one of the URLs
   * {@link AgentSession.repositories} lists for the caller. Omitted, the
   * runtime chooses from the prompt. Honored for Cursor sessions; omit
   * `agent` and the session starts as Cursor.
   */
  repoUrl?: string;
  /**
   * The branch the session starts on; needs `repoUrl`. Omitted, the
   * repository's default branch.
   */
  repoBranch?: string;
};

/** A managed or externally hosted coding-agent session. */
export class AgentSession extends MacroEntity<AgentSessionResponse> {
  /** Access requests and direct user grants. */
  readonly access = new EntityAccess(this.client, 'agent_session', this);

  /**
   * Construct an approval handle scoped to this session.
   *
   * @readonly
   */
  toolApprovalById(id: string): ToolApproval {
    return ToolApproval.byId(this.client, this, id);
  }

  /**
   * Sharing configuration.
   *
   * @readonly
   */
  async sharePermissions() {
    return unwrap(
      await this.client.agentHarness.getAgentSessionPermissions({
        path: { session_id: this.id },
      }),
    );
  }

  /**
   * Replace sharing grants.
   *
   * @write
   * @idempotent
   */
  async updateSharePermissions(options: SharePermissionOptions) {
    return this.mutate((c) =>
      c.agentHarness.updateAgentSessionPermissions({
        path: { session_id: this.id },
        body: sharePermissionBody(options),
      }),
    );
  }

  /**
   * The session's URL in the Macro web app; hand it to users as the link.
   *
   * @readonly
   */
  webUrl(): string {
    return `${this.client.webAppUrl}/app/agent/${this.id}`;
  }

  /** Identity, loaded detail and {@link webUrl}, so serialized handles carry their link. */
  override toJSON() {
    return { ...super.toJSON(), url: this.webUrl() };
  }

  /** A handle to an agent session by id. Details load on first access. */
  static byId(client: MacroClient, id: string): AgentSession {
    return new AgentSession(client, id);
  }

  /**
   * Create a managed session as `agent` when one is named, otherwise the
   * deployment's default coding persona. List personas with
   * {@link AgentNamespace.list} and construct one with {@link Agent.byId}.
   * Unknown or inaccessible personas fail. `model` and `instructions`
   * outrank the persona's. `repoUrl` is honored for Cursor; omit `agent`
   * and it starts as Cursor.
   */
  static async createManaged(
    client: MacroClient,
    opts?: CreateManagedSessionOptions,
  ): Promise<AgentSession> {
    const { session } = unwrap(
      await client.agentHarness.createAgentSession({
        body: {
          botId: opts?.agent?.id,
          prompt: opts?.prompt,
          instructions: opts?.instructions,
          model: opts?.model,
          repoUrl: opts?.repoUrl,
          repoBranch: opts?.repoBranch,
        },
      }),
    );
    return new AgentSession(client, session.id, session);
  }

  /**
   * The GitHub repositories the caller can hand a managed session: every
   * repository under an installation of Macro's GitHub App they or their
   * teams made, sorted by `owner/name`. Empty when the App is installed
   * nowhere they reach.
   */
  static async repositories(
    client: MacroClient,
  ): Promise<SelectableRepository[]> {
    const { repositories } = unwrap(
      await client.agentHarness.listAgentRepositories(),
    );
    return repositories.map((repository) => ({
      url: repository.url,
      defaultBranch: repository.defaultBranch ?? undefined,
    }));
  }

  /**
   * Branch names on one repository the caller can start a managed session
   * from, in the order GitHub listed them. Empty when the repository has
   * no commits yet. `repoUrl` is one of the URLs {@link AgentSession.repositories}
   * lists.
   */
  static async repositoryBranches(
    client: MacroClient,
    repoUrl: string,
  ): Promise<string[]> {
    const { branches } = unwrap(
      await client.agentHarness.listAgentRepositoryBranches({
        query: { repoUrl },
      }),
    );
    return branches;
  }

  /**
   * Whether `prompt` needs a chat agent or a coding agent, as the app's Auto
   * mode decides before starting a session. Rejects when Auto mode is not
   * enabled for the caller, the classifier is unavailable or slow, or the
   * caller is out of AI quota.
   */
  static async chooseMode(
    client: MacroClient,
    prompt: string,
  ): Promise<AgentMode> {
    const { mode } = unwrap(
      await client.agentHarness.chooseAgentMode({ body: { prompt } }),
    );
    return mode;
  }

  protected async fetch(): Promise<AgentSessionResponse> {
    return unwrap(
      await this.client.agentHarness.getAgentSession({
        path: { session_id: this.id },
      }),
    );
  }

  /** The session's user-facing display name. */
  readonly name = this.field('name');

  /**
   * What opened the session: who or what started it, and what it is about.
   * Readable by anyone who can view the session, including other agents.
   *
   * @readonly
   */
  async origin(): Promise<SessionOrigin> {
    const detail = await this.detail.get();
    return sessionOrigin(
      this.client,
      detail.origin ?? { origin: 'unknown' },
      detail.threadChannelId ?? undefined,
    );
  }

  /**
   * Who archived the session, making it read-only: `'user'`,
   * `'pull_request_merged'` or `'runtime_closed'`. `undefined` while it is not
   * archived.
   */
  readonly archivedBy = this.field('archivedBy');

  /** When the session was archived (RFC 3339), or `undefined` while it is not. */
  readonly archivedAt = this.field('archivedAt');

  /** The model currently configured for the session. */
  readonly model = this.field('model');

  /** The agent harness implementation serving the session. */
  readonly harness = this.field('harness');

  /** The repository the agent works with, when one was supplied. */
  readonly repoUrl = this.field('repoUrl');

  /** The directory in which the agent harness runs. */
  readonly workspace = this.field('workspace');

  /**
   * Instructions the session's runtime works under, when any were stated at
   * creation. Fixed for the session's life.
   */
  readonly instructions = this.field('instructions');

  /** The session's latest runtime status. */
  readonly status = this.field('status');

  /** Compute tier of the managed sandbox. */
  readonly sandboxSize = this.field('sandboxSize');

  /** When the session was created. */
  readonly createdAt = this.field('createdAt');

  /** When the session was last modified. */
  readonly modifiedAt = this.field('modifiedAt');

  /**
   * The sessions linked to the GitHub pull request at `url` that the caller
   * can view, oldest link first.
   */
  static async forPullRequest(
    client: MacroClient,
    url: string,
  ): Promise<AgentSession[]> {
    const { sessionIds } = unwrap(
      await client.agentHarness.agentSessionsForPullRequest({ body: { url } }),
    );
    return sessionIds.map((id) => AgentSession.byId(client, id));
  }

  /**
   * The caller's coding sessions waiting for an answer from them, or stalled
   * for over 20 minutes, newest activity first. Only the 25 most recent such
   * sessions are inspected.
   */
  static async updates(client: MacroClient): Promise<AgentSessionUpdates> {
    const { items, truncated, truncationNotice } = unwrap(
      await client.agentHarness.listAgentSessionUpdates(),
    );
    return {
      items: items.map((item) => ({
        session: AgentSession.byId(client, item.sessionId),
        sessionName: item.sessionName,
        harness: item.harness,
        pullRequestUrl: item.pullRequestUrl ?? undefined,
        kind: item.kind,
        summary: item.summary,
        since: item.since,
        options: item.options,
      })),
      truncated,
      truncationNotice: truncationNotice ?? undefined,
    };
  }

  /**
   * Tool calls this session's runtime holds until its owner approves them,
   * oldest first. Answer each with {@link ToolApproval.answer}; only the
   * owner may approve or decline. Permission requests and questions from the
   * agent itself are answered with {@link control}.
   *
   * @readonly
   */
  async pendingApprovals(): Promise<PendingToolApproval[]> {
    const { messages } = await this.foldedLog();
    return messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.kind === 'tool_approval' && part.status === 'pending'
          ? [
              {
                approval: ToolApproval.byId(this.client, this, part.approvalId),
                serverName: part.serverName,
                toolName: part.toolName,
                arguments: part.arguments,
                requestedBy: part.requestedBy
                  ? User.byId(this.client, part.requestedBy)
                  : undefined,
              },
            ]
          : [],
      ),
    );
  }

  /**
   * Link this session to the task it works on, replacing any earlier link.
   * Only the session's owner can link it, to a task they can view. The
   * session's pull request, now or later, is linked to the task too.
   *
   * @write
   */
  async linkTask(task: Task): Promise<LinkedTask> {
    const linked = unwrap(
      await this.client.agentHarness.linkAgentSessionTask({
        path: { session_id: this.id },
        body: { taskId: task.id },
      }),
    );
    return {
      task: Task.byId(this.client, linked.taskId),
      reference: linked.reference,
      pullRequestUrl: linked.pullRequestUrl ?? undefined,
    };
  }

  /**
   * The GitHub pull requests linked to this session: the one its agent
   * opened and any a person linked, oldest first.
   *
   * @readonly
   */
  async pullRequests(): Promise<SessionPullRequest[]> {
    const { pullRequests } = unwrap(
      await this.client.agentHarness.listAgentSessionPullRequests({
        path: { session_id: this.id },
      }),
    );
    return pullRequests.map((link) => ({
      githubKey: link.githubKey,
      url: link.url,
      source: link.source,
      linkedBy: link.linkedBy
        ? User.byId(this.client, link.linkedBy)
        : undefined,
      createdAt: link.createdAt,
    }));
  }

  /**
   * Link the GitHub pull request at `url` to this session. Linking one that
   * is already linked changes nothing.
   *
   * @write
   * @idempotent
   */
  async linkPullRequest(url: string): Promise<void> {
    unwrap(
      await this.client.agentHarness.linkAgentSessionPullRequest({
        path: { session_id: this.id },
        body: { url },
      }),
    );
  }

  /**
   * Unlink a GitHub pull request a person linked to this session. The pull
   * request the session's agent opened stays linked.
   *
   * @write
   * @idempotent
   */
  async unlinkPullRequest(url: string): Promise<void> {
    unwrap(
      await this.client.agentHarness.unlinkAgentSessionPullRequest({
        path: { session_id: this.id },
        query: { url },
      }),
    );
  }

  /**
   * This session's auto-archive settings, and when a trigger archived it.
   *
   * @readonly
   */
  async autoArchive(): Promise<SessionAutoArchive> {
    const { overrides, defaults, autoArchivedAt } = unwrap(
      await this.client.agentHarness.getAgentSessionAutoArchive({
        path: { session_id: this.id },
      }),
    );
    return {
      overrides: {
        onPullRequestMerged: overrides.onPullRequestMerged ?? undefined,
        onRuntimeClosed: overrides.onRuntimeClosed ?? undefined,
      },
      defaults,
      autoArchivedAt: autoArchivedAt ?? undefined,
    };
  }

  /**
   * Replace this session's auto-archive choices. Owner only; a trigger left
   * `undefined` follows the owner's default.
   *
   * @write
   * @idempotent
   */
  async setAutoArchive(overrides: AutoArchiveOverrides): Promise<void> {
    unwrap(
      await this.client.agentHarness.putAgentSessionAutoArchive({
        path: { session_id: this.id },
        body: {
          onPullRequestMerged: overrides.onPullRequestMerged ?? null,
          onRuntimeClosed: overrides.onRuntimeClosed ?? null,
        },
      }),
    );
  }

  /**
   * Rename this session.
   *
   * @write
   * @idempotent
   */
  async rename(name: string): Promise<void> {
    await this.mutate((client) =>
      client.agentHarness.renameAgentSession({
        path: { session_id: this.id },
        body: { name },
      }),
    );
  }

  /**
   * Register this session as the caller's work, so it shows as what the caller
   * is working on. Requires edit access. Registering again changes nothing.
   *
   * Registering does not share the session: a viewer who cannot open it does
   * not see it, so share it too with {@link AgentSession.updateSharePermissions}.
   *
   * The registration ends on its own when the session's pull requests finish,
   * when it is archived, after a day without work, or after a week blocked on
   * input. A later turn does not register it again.
   *
   * @write
   * @idempotent
   */
  async registerAsWork(): Promise<RegisteredWork> {
    return AgentSession.registeredWork(
      this.client,
      unwrap(
        await this.client.agentHarness.registerAgentSessionWork({
          path: { session_id: this.id },
        }),
      ),
    );
  }

  /**
   * End the caller's registration of this session as its work. Doing it again
   * changes nothing. The session itself is untouched.
   *
   * @write
   * @idempotent
   */
  async unregisterAsWork(): Promise<void> {
    unwrap(
      await this.client.agentHarness.unregisterAgentSessionWork({
        path: { session_id: this.id },
      }),
    );
  }

  /** The caller's active registrations, newest first. */
  static async listRegisteredWork(
    client: MacroClient,
  ): Promise<RegisteredWork[]> {
    const registrations = unwrap(
      await client.agentHarness.listAgentWorkRegistrations(),
    );
    return registrations.map((registration) =>
      AgentSession.registeredWork(client, registration),
    );
  }

  private static registeredWork(
    client: MacroClient,
    registration: WorkRegistrationResponse,
  ): RegisteredWork {
    return {
      session: AgentSession.byId(client, registration.agentSessionId),
      account: User.byId(client, registration.accountId),
      registeredAt: registration.registeredAt,
    };
  }

  /**
   * Archive this session, making it read-only until unarchived.
   *
   * @write
   * @idempotent
   */
  async archive(): Promise<void> {
    await this.setArchived(true);
  }

  /**
   * Restore an archived session so it can be edited and prompted again.
   *
   * @write
   * @idempotent
   */
  async unarchive(): Promise<void> {
    await this.setArchived(false);
  }

  private async setArchived(archived: boolean): Promise<void> {
    await this.mutate((client) =>
      client.agentHarness.setAgentSessionArchived({
        path: { session_id: this.id },
        body: { archived },
      }),
    );
  }

  /**
   * Resize this session's sandbox and remember the size as the owner's default.
   *
   * @write
   * @idempotent
   */
  async setSandboxSize(size: SandboxSize): Promise<SandboxSize> {
    const { size: next } = await this.mutate((client) =>
      client.agentHarness.putAgentSessionSandboxSize({
        path: { session_id: this.id },
        body: { size },
      }),
    );
    return next;
  }

  /** The caller's default sandbox size for new `@coder` sessions. */
  static async defaultSandboxSize(client: MacroClient): Promise<SandboxSize> {
    return unwrap(await client.agentHarness.getAgentSandboxSize()).size;
  }

  /** Set the caller's default sandbox size for the next `@coder` mention. */
  static async setDefaultSandboxSize(
    client: MacroClient,
    size: SandboxSize,
  ): Promise<SandboxSize> {
    return unwrap(
      await client.agentHarness.putAgentSandboxSize({
        body: { size },
      }),
    ).size;
  }

  /** What the caller's new coding sessions are told to do beyond their assignment. */
  static async codingPreferences(
    client: MacroClient,
  ): Promise<CodingPreferencesBody> {
    return unwrap(await client.agentHarness.getAgentCodingPreferences());
  }

  /** Which triggers archive the caller's sessions by default; each is off unless chosen. */
  static async autoArchivePreferences(
    client: MacroClient,
  ): Promise<AutoArchivePreferencesBody> {
    return unwrap(await client.agentHarness.getAgentAutoArchivePreferences());
  }

  /** Replace which triggers archive the caller's sessions by default. */
  static async setAutoArchivePreferences(
    client: MacroClient,
    preferences: AutoArchivePreferencesBody,
  ): Promise<AutoArchivePreferencesBody> {
    return unwrap(
      await client.agentHarness.putAgentAutoArchivePreferences({
        body: preferences,
      }),
    );
  }

  /** Replace the caller's coding preferences. */
  static async setCodingPreferences(
    client: MacroClient,
    preferences: CodingPreferencesBody,
  ): Promise<CodingPreferencesBody> {
    return unwrap(
      await client.agentHarness.putAgentCodingPreferences({
        body: preferences,
      }),
    );
  }

  /**
   * Send a prompt or lifecycle operation to the live agent session.
   *
   * The returned `actionId` matches `requestId` on the folded message the
   * action derives once it dispatches. A `queued` status means a turn was
   * running: the action waits in the session's queue ({@link queue}) and
   * dispatches when that turn ends.
   *
   * @destructive
   * @openworld
   */
  async control(action: AgentAction): Promise<ControlResponse> {
    return this.mutate((client) =>
      client.agentHarness.controlAgentSession({
        path: { session_id: this.id },
        body: action,
      }),
    );
  }

  /**
   * Send a prompt to the session — sugar over {@link control}.
   *
   * `attachments` are files the prompt refers to, each by a URL the agent
   * can fetch (a static file service URL in practice); they reach the agent
   * as ACP `resource_link` blocks after the text.
   *
   * @destructive
   * @openworld
   */
  prompt(
    text: string,
    attachments?: PromptAttachment[],
  ): Promise<ControlResponse> {
    return this.control({
      type: 'prompt',
      prompt: text,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    });
  }

  /**
   * The actions waiting to dispatch in this session, oldest first. Each can
   * be edited or removed until it dispatches.
   *
   * @readonly
   */
  async queue(): Promise<QueuedAction[]> {
    const { entries } = unwrap(
      await this.client.agentHarness.getAgentSessionQueue({
        path: { session_id: this.id },
      }),
    );
    return entries.map((entry) =>
      QueuedAction.from(this.client, this.id, entry),
    );
  }

  /**
   * Read the latest captured GitHub pull request changes and capture status.
   *
   * @readonly
   */
  async changes(): Promise<AgentSessionChangesResponse> {
    return unwrap(
      await this.client.agentHarness.getAgentSessionChanges({
        path: { session_id: this.id },
      }),
    );
  }

  /**
   * Read the unified diff of the latest captured changeset.
   *
   * @readonly
   */
  async changesPatch(): Promise<string> {
    return unwrap(
      await this.client.agentHarness.getAgentSessionChangesPatch({
        path: { session_id: this.id },
      }),
    ).patch;
  }

  /**
   * Request a fresh capture and return the current state while it runs.
   *
   * @write
   * @idempotent
   * @openworld
   */
  async refreshChanges(): Promise<AgentSessionChangesResponse> {
    return this.mutate((client) =>
      client.agentHarness.refreshAgentSessionChanges({
        path: { session_id: this.id },
      }),
    );
  }

  /**
   * Read this session's whole history as the conversation the app renders:
   * each user prompt and agent reply, oldest first, with tool calls and their
   * results, plans, permission requests and how each turn ended. Works on any
   * session the caller can view, live or finished, so it is the way to read
   * what another agent session did. Prefer it to {@link log}, which returns
   * raw protocol frames.
   *
   * @readonly
   */
  async foldedLog(): Promise<FoldedAgentSessionLog> {
    const { bot, messages } = unwrap(
      await this.client.agentHarness.getAgentSessionFoldedLog({
        path: { session_id: this.id },
      }),
    );
    // The schema is opaque: the server serializes the fold's `FoldedMessage`,
    // whose TypeScript contract is generated from the same Rust type.
    return { bot, messages: messages as FoldedMessage[] };
  }

  /**
   * Read the complete raw protocol log for this session.
   *
   * @readonly
   */
  async log(): Promise<AgentSessionLogResponse> {
    return unwrap(
      await this.client.agentHarness.getAgentSessionLog({
        path: { session_id: this.id },
      }),
    );
  }

  /** Persisted reviews scoped to this session, with or without a code execution. */
  readonly reviews = {
    create: (input: CreateReviewOptions) =>
      SessionReview.createForSession(this.client, this, input),
    byId: (id: string) => SessionReview.byId(this.client, this, id),
  };

  /** Views shown in this session at once, with nothing saved. */
  readonly views = {
    present: (view: SessionView) => presentView(this.client, this, view),
  };

  /** Saved code executions scoped to this session. Handle construction makes no request. */
  readonly codeExecutions = {
    byId: (id: string): CodeExecution =>
      CodeExecution.byId(this.client, this, id),
  };

  /**
   * Recorded activity caused by this session, lazily paginated newest first.
   *
   * @readonly
   */
  activity(options: AgentActivityOptions = {}) {
    return sessionActivity(this.client, this, options);
  }

  /** Code-mode invocation handles, distinct from saved code executions. */
  readonly invocations = {
    byId: (id: string) => AgentInvocation.byId(this.client, this, id),
  };

  /**
   * Delete this session and any live resources it owns.
   *
   * @destructive
   * @idempotent
   */
  async delete(): Promise<void> {
    await this.mutate((client) =>
      client.agentHarness.deleteAgentSession({
        path: { session_id: this.id },
      }),
    );
  }
}
