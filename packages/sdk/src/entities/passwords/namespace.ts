import { v7 as uuidv7 } from 'uuid';
import type { PasswordAgentCreateSecret } from '../../../generated/storage/types.gen';
import { paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { Team } from '../teams/team';
import { type AgentWake, PasswordItem, vaultHeaders } from './item';

/**
 * Team vault access for the authenticated agent. Only the agent's own API key
 * can use it; human vault routes are not part of the SDK.
 *
 * @mcp-exclude Agent vault values must reach only the agent's secrets capability, never model context.
 */
export class PasswordNamespace {
  constructor(private readonly client: MacroClient) {}

  /** The team's vault as this agent sees it during one wake. */
  forAgent(team: Team, wake: AgentWake): AgentVault {
    return new AgentVault(this.client, team, wake);
  }
}

/**
 * One team's vault for one agent wake. Every call recomputes the agent's
 * current access.
 *
 * @mcp-exclude Agent vault values must reach only the agent's secrets capability, never model context.
 */
export class AgentVault {
  constructor(
    private readonly client: MacroClient,
    /** The team that owns the vault. */
    readonly team: Team,
    private readonly wake: AgentWake,
  ) {}

  /** Items the agent may use or request, newest first, metadata only. */
  search(query?: string): AsyncGenerator<PasswordItem> {
    return paginate(async (cursor) => {
      const page = unwrap(
        await this.client.storage.passwordsAgentSearch({
          path: { team: this.team.id },
          headers: { 'X-Macro-Agent-Session-Id': this.wake.wake },
          query: { q: query ?? null, cursor: cursor ?? null },
        }),
      );
      return {
        items: page.items.map((hit) =>
          PasswordItem.fromHit(this.client, this.team, this.wake, hit),
        ),
        nextCursor: page.nextCursor,
      };
    });
  }

  /**
   * Create a login or API item owned by the team and usable by this agent at
   * once. A retry with the same `operationId` returns the same item.
   */
  async create(opts: {
    name: string;
    url?: string;
    secret: PasswordAgentCreateSecret;
    /** UUIDv7 stable across retries; generated when omitted. */
    operationId?: string;
  }): Promise<PasswordItem> {
    const result = unwrap(
      await this.client.storage.passwordsAgentCreate({
        path: { team: this.team.id },
        headers: vaultHeaders(this.wake),
        body: {
          operationId: opts.operationId ?? uuidv7(),
          name: opts.name,
          url: opts.url ?? null,
          secret: opts.secret,
        },
      }),
    );
    return PasswordItem.fromHit(this.client, this.team, this.wake, result.item);
  }
}
