import type {
  ChatAgentKind,
  ChatResponse,
  GetAgentResponse,
} from '../../../generated/agent-proxy/types.gen';
import { type Mentionable, type MentionPart, wrapXml } from '../../mentions';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { PropertiedEntity } from '../entity';
import { Project } from '../projects/project';

/** An external coding agent, proxied through agent_proxy_service. Backed by
 * the same chat row a regular {@link Chat} is (`id` is the chat id), just
 * with `kind: 'External'`, so favorites/properties treat it identically. */
export class Agent
  extends PropertiedEntity<GetAgentResponse>
  implements Mentionable
{
  /** Favorites identify agents as `chat` — an agent is a chat under the hood. */
  readonly entityType = 'chat';

  /** The properties service identifies agents as `CHAT`, same as a chat. */
  protected readonly propertyEntityType = 'CHAT';

  protected async fetch(): Promise<GetAgentResponse> {
    return unwrap(
      await this.client.agentProxy.getAgent({ path: { agent_id: this.id } }),
    );
  }

  /** A lazy accessor for one field of the agent's backing chat. */
  private chatField<T>(get: (chat: ChatResponse) => T): () => Promise<T> {
    return async () => get((await this.detail.get()).chat);
  }

  /** A handle to an agent by id. Details load on first access. */
  static byId(client: MacroClient, id: string): Agent {
    return new Agent(client, id);
  }

  /** Create an agent, optionally named and attached to a project. Defaults
   * to `kind: 'External'` — pass `kind: 'MacroChat'` to back it with a
   * regular chat instead. */
  static async create(
    client: MacroClient,
    opts?: { name?: string; kind?: ChatAgentKind; project?: Project },
  ): Promise<Agent> {
    const { id } = unwrap(
      await client.agentProxy.createAgent({
        body: {
          name: opts?.name ?? null,
          kind: opts?.kind ?? 'External',
          projectId: opts?.project?.id ?? null,
        },
      }),
    );
    return new Agent(client, id);
  }

  /** What kind of agent this is — always `'External'` for agents created via
   * {@link create}'s default, but reflects the actual backing chat. */
  readonly kind = this.field('kind');

  /** The requesting user's access level on this agent. */
  readonly userAccessLevel = this.field('userAccessLevel');

  /** The agent's display name. */
  readonly name = this.chatField((c) => c.name);

  /** The model used to generate the chat (`provider/model` id), if set. */
  readonly model = this.chatField((c) => c.model ?? undefined);

  /** The project this agent belongs to, if any. */
  readonly project = this.chatField((c) =>
    c.projectId ? Project.byId(this.client, c.projectId) : undefined,
  );

  /** When the agent was created. */
  readonly createdAt = this.chatField((c) => c.createdAt ?? undefined);

  /** When the agent was last updated. */
  readonly updatedAt = this.chatField((c) => c.updatedAt ?? undefined);

  /** The messages in the agent's chat, with their attachments. */
  readonly messages = this.chatField((c) => c.messages);

  /** Rename the agent. */
  async rename(name: string): Promise<void> {
    await this.mutate((c) =>
      c.agentProxy.patchAgent({
        path: { agent_id: this.id },
        body: { name },
      }),
    );
  }

  /** Move the agent to a different project (or clear it, with `project: null`). */
  async move(project: Project | null): Promise<void> {
    await this.mutate((c) =>
      c.agentProxy.patchAgent({
        path: { agent_id: this.id },
        body: { projectId: project?.id ?? null },
      }),
    );
  }

  /**
   * Delete the agent. Soft by default; pass `permanent: true` to delete
   * irreversibly.
   */
  async delete(opts?: { permanent?: boolean }): Promise<void> {
    await this.mutate((c) =>
      opts?.permanent
        ? c.agentProxy.permanentlyDeleteAgent({ path: { agent_id: this.id } })
        : c.agentProxy.deleteAgent({ path: { agent_id: this.id } }),
    );
  }

  /**
   * Send a user prompt to this agent's session - the message the agent
   * execution responds to, delivered as an ACP `session/prompt` request.
   *
   * Safe to call before the session's runtime exists: agent_proxy durably
   * queues messages posted before a runtime's ACP session is ready and
   * delivers them, in order, once it is. The proxy also stamps the live ACP
   * session id onto the request, so callers never need to know it.
   */
  async prompt(text: string): Promise<void> {
    await this.postAcpMessage({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'session/prompt',
      params: {
        // Placeholder overwritten by the proxy with the live ACP session id.
        sessionId: '',
        prompt: [{ type: 'text', text }],
      },
    });
  }

  /**
   * Post one ACP JSON-RPC message to this agent's session (request,
   * notification, or response) — replies stream back through the connection
   * gateway rather than this call's response.
   */
  async postAcpMessage(message: unknown): Promise<void> {
    await this.mutate((c) =>
      c.agentProxy.postAcpMessage({
        path: { session_id: this.id },
        body: message,
      }),
    );
  }

  /** The agent's URL in the Macro web app (it's a chat under the hood). */
  webUrl(): string {
    return `${this.client.webAppUrl}/app/chat/${this.id}`;
  }

  /** Mentions as a chat — an agent is a chat under the hood. */
  toMention(): MentionPart {
    return {
      tag: wrapXml('m-document-mention', {
        documentId: this.id,
        documentName: this.detail.peek()?.chat.name ?? '',
        blockName: 'chat',
        blockParams: {},
      }),
      mention: { entity_type: 'chat', entity_id: this.id },
    };
  }
}
