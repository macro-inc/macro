import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { throwOnErr } from '@core/util/result';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { fetchGraphqlAgentSessionMentions } from '@service-storage/agent-session-mentions';
import { storageServiceClient } from '@service-storage/client';
import type {
  GraphqlAgentSessionExpr,
  SoupInput,
} from '@service-storage/graphql/generated/graphql';
import { botsQueryOptions } from '../bots/bots';
import { firstPartyBotName } from '../bots/first-party-bot-name';
import { queryClient } from '../client';
import { buildGraphqlEntitySoupInput } from '../soup/graphql/entity-input';
import {
  type AgentSessionMentionData,
  type AgentSessionMentionPreview,
  normalizeAgentSessionStatus,
} from './mention-types';

const NIL_ID = '00000000-0000-0000-0000-000000000000';

function sessionIdsExpr(ids: string[]): GraphqlAgentSessionExpr {
  if (ids.length === 1) return { literal: { id: ids[0] } };
  const middle = Math.floor(ids.length / 2);
  return {
    or: {
      left: sessionIdsExpr(ids.slice(0, middle)),
      right: sessionIdsExpr(ids.slice(middle)),
    },
  };
}

export function agentSessionMentionInput(ids?: string[]): SoupInput {
  if (ids?.length === 0)
    throw new Error('Agent session lookup requires at least one id');
  const base = buildGraphqlEntitySoupInput('DOCUMENT', NIL_ID)!;
  return {
    initial: {
      ...base.initial!,
      limit: ids?.length ?? 500,
      filters: {
        ...base.initial!.filters,
        agentSessionFilter: ids
          ? sessionIdsExpr(ids)
          : { literal: { include: true } },
      },
    },
  };
}

/** Older preview responses may identify the persona only by botId. */
async function withSessionPersonaNames(
  sessions: AgentSessionMentionData[]
): Promise<AgentSessionMentionData[]> {
  const namedSessions = sessions.map((session) => {
    if (session.bot?.name) return session;
    const name = firstPartyBotName(session.botId);
    return name
      ? { ...session, bot: { ...session.bot, id: session.botId, name } }
      : session;
  });
  if (namedSessions.every((session) => session.bot?.name)) return namedSessions;
  try {
    const bots = await queryClient.ensureQueryData(botsQueryOptions());
    const byId = new Map(bots.map((bot) => [bot.id, bot]));
    return namedSessions.map((session) => {
      if (session.bot?.name) return session;
      const bot = byId.get(session.botId);
      if (!bot) return session;
      return {
        ...session,
        bot: { id: bot.id, name: bot.name, avatarUrl: bot.avatar_url },
      };
    });
  } catch (error) {
    console.warn('Failed to load agent session persona names', error);
    return namedSessions;
  }
}

export async function fetchRecentAgentSessionMentions(
  graphql: boolean
): Promise<AgentSessionMentionData[]> {
  if (graphql) {
    const items = await fetchGraphqlAgentSessionMentions(
      agentSessionMentionInput()
    );
    return withSessionPersonaNames(
      items.map((item) => ({
        ...item,
        status: normalizeAgentSessionStatus(item.status),
      }))
    );
  }
  const page = await throwOnErr(() =>
    storageServiceClient.getSoupItems({
      params: {},
      body: {
        ...QUERY_FILTERS_BASE,
        agent_session_filters: { include: true },
        limit: 500,
        sort_method: 'updated_at',
      },
    })
  );
  const ids = page.items.flatMap((item) =>
    item.tag === 'agentSession' ? [item.data.id] : []
  );
  const batches: Promise<Map<string, AgentSessionMentionPreview>>[] = [];
  for (let start = 0; start < ids.length; start += 50) {
    batches.push(
      fetchAgentSessionMentionPreviews(ids.slice(start, start + 50), false)
    );
  }
  const previews = new Map(
    (await Promise.all(batches)).flatMap((batch) => [...batch])
  );
  return withSessionPersonaNames(
    ids.flatMap((id) => {
      const preview = previews.get(id);
      return preview?.access === 'access' ? [preview.data] : [];
    })
  );
}

export async function fetchAgentSessionMentionPreviews(
  ids: string[],
  graphql: boolean
): Promise<Map<string, AgentSessionMentionPreview>> {
  if (ids.length === 0) return new Map();
  const result = new Map<string, AgentSessionMentionPreview>();
  if (graphql) {
    const items = await fetchGraphqlAgentSessionMentions(
      agentSessionMentionInput(ids)
    );
    for (const item of items)
      result.set(item.id, {
        access: 'access',
        data: { ...item, status: normalizeAgentSessionStatus(item.status) },
      });
    // Absence in Soup cannot distinguish deletion from revoked access. Use
    // the permission-aware preview endpoint only for these missing records.
    ids = ids.filter((id) => !result.has(id));
  }
  if (ids.length === 0) return result;
  const response = await throwOnErr(() =>
    agentHarnessServiceClient.preview(ids)
  );
  for (const preview of response.previews) {
    if (preview.type !== 'access') {
      result.set(preview.id, { access: preview.type });
      continue;
    }
    result.set(preview.id, {
      access: 'access',
      data: {
        ...preview,
        updatedAt: preview.modifiedAt,
        bot: preview.bot,
      },
    });
  }
  return result;
}
