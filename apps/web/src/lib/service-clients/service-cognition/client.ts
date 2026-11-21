import { SERVER_HOSTS } from '@core/constant/servers';
import { cache } from '@core/util/cache';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import { platformFetch } from '@core/util/platformFetch';
import type { ObjectLike, ResultError } from '@core/util/result';
import type { SafeFetchInit } from '@core/util/safeFetch';
import type { DocumentTextPart } from '@service-cognition/generated/schemas/documentTextPart';
import { err, ok, type Result } from 'neverthrow';
import type OpenAI from 'openai';
import {
  type AI_USAGE_LIMIT_ERROR,
  aiUsageErrorResponseHandler,
} from '../ai-usage-limit';
import type { AddServerRequest } from './generated/schemas/addServerRequest';
import type { DatabaseQueryAnswer } from './generated/schemas/databaseQueryAnswer';
import type { DatabaseQueryRequest } from './generated/schemas/databaseQueryRequest';
import type { GetBatchPreviewRequest } from './generated/schemas/getBatchPreviewRequest';
import type { GetBatchPreviewResponse } from './generated/schemas/getBatchPreviewResponse';
import type { GetChatPermissionsResponse } from './generated/schemas/getChatPermissionsResponse';
import type { GetChatResponse } from './generated/schemas/getChatResponse';
import type { GetChatsForAttachmentResponse } from './generated/schemas/getChatsForAttachmentResponse';
import type { PipedreamCatalogResponse } from './generated/schemas/pipedreamCatalogResponse';
import type { PipedreamOverlayResponse } from './generated/schemas/pipedreamOverlayResponse';
import type { ServerResponse } from './generated/schemas/serverResponse';
import type { StartAuthRequest } from './generated/schemas/startAuthRequest';
import type { StartAuthResponse } from './generated/schemas/startAuthResponse';
import type { StopChatStreamRequest } from './generated/schemas/stopChatStreamRequest';
import type { StopChatStreamResponse } from './generated/schemas/stopChatStreamResponse';
import type { StructuredCompletionRequest } from './generated/schemas/structuredCompletionRequest';
import type { StructuredCompletionResponse } from './generated/schemas/structuredCompletionResponse';
import type { UpdateServerRequest } from './generated/schemas/updateServerRequest';

const dcsHost: string = SERVER_HOSTS['cognition-service'];

type WithChatId = { chat_id: string };

function dcsFetch(
  url: string,
  init?: SafeFetchInit
): Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>>;
function dcsFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>;
function dcsFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>
  | Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>> {
  return fetchWithToken<T>(`${dcsHost}${url}`, init);
}

type IdMappingResponse = { target_id: string | null };

// Hand-written mirrors of the DCS OpenAPI types for the Pipedream MCP
// connector endpoints (`/pipedream/mcp/*`); replace with the orval-generated
// schemas on the next client regeneration.
/** The backend holding a connection's grant. */
export type PipedreamProvider = 'pipedream' | 'connect';
export type PipedreamConnectionResponse = {
  app_slug: string;
  server_name: string;
  enabled: boolean;
  provider?: PipedreamProvider;
};
export type PipedreamUpdateRequest = {
  app_slug: string;
  server_name?: string;
  enabled?: boolean;
};
export type PipedreamTokenRequest = {
  /** With it, an app Macro Connect serves may answer with a Connect URL. */
  app_slug?: string;
};
/** A Pipedream Connect token, or for `provider: 'connect'` a Connect URL. */
export type PipedreamTokenResponse = {
  provider: PipedreamProvider;
  token?: string | null;
  expires_at?: string | null;
  connect_link_url?: string | null;
  connect_url?: string | null;
};
export type PipedreamConnectCompleteRequest = {
  app_slug: string;
  server_name?: string;
};
export type PipedreamCompleteRequest = {
  account_id: string;
  server_name?: string;
};
export type PipedreamRecoverRequest = {
  app_slug: string;
  server_name?: string;
};
export type { PipedreamCatalogEntryResponse } from './generated/schemas/pipedreamCatalogEntryResponse';
export type { PipedreamCatalogResponse } from './generated/schemas/pipedreamCatalogResponse';
export type { PipedreamOverlayResponse } from './generated/schemas/pipedreamOverlayResponse';

/** Error code for deployments where Pipedream MCP connect is not configured. */
export const PIPEDREAM_DISABLED = 'PIPEDREAM_DISABLED' as const;

/** `startMcpAuth`'s error code when Macro refuses the server's sign-in page. */
export const SIGN_IN_PAGE_REFUSED = 'SIGN_IN_PAGE_REFUSED' as const;

export const cognitionApiServiceClient = {
  /** Creates a mapping from source_id to target_id */
  async createIdMapping(args: { source_id: string; target_id: string }) {
    const { source_id, target_id } = args;
    return (
      await dcsFetch<{ success: boolean }>(`/id_mapping/${source_id}`, {
        method: 'POST',
        body: JSON.stringify({ target_id }),
      })
    ).map((result) => result);
  },

  /** Gets the target_id for a given source_id */
  async getIdMapping(args: { source_id: string }) {
    const { source_id } = args;
    return (
      await dcsFetch<IdMappingResponse>(`/id_mapping/${source_id}`, {
        method: 'GET',
      })
    ).map((result) => result.target_id);
  },

  getChat: cache(
    async function getChat(args: WithChatId) {
      const { chat_id } = args;
      return (
        await dcsFetch<GetChatResponse>(`/chats/${chat_id}`, {
          method: 'GET',
        })
      ).map((result) => result);
    },
    {
      seconds: 5,
    }
  ),

  async getChatPermissions(args: { id: string }) {
    const { id } = args;
    return (
      await dcsFetch<GetChatPermissionsResponse>(`/chats/${id}/permissions`, {
        method: 'GET',
      })
    ).map((result) => result.permissions);
  },
  async getChatsForAttachment(args: { attachment_id: string }) {
    const { attachment_id } = args;
    return (
      await dcsFetch<GetChatsForAttachmentResponse>(
        `/attachments/${attachment_id}/chats`,
        {
          method: 'GET',
        }
      )
    ).map((result) => result);
  },

  getCitation: cache(
    async function getCitation(args) {
      return (await dcsFetch<DocumentTextPart>(`/citations/${args.id}`)).map(
        (result) => result
      );
    },
    {
      forever: true,
    }
  ),
  async getBatchChatPreviews(args: GetBatchPreviewRequest) {
    return (
      await dcsFetch<GetBatchPreviewResponse>(`/preview`, {
        method: 'POST',
        body: JSON.stringify(args),
      })
    ).map((result) => result);
  },
  /** Stops an in-flight AI chat stream. The streaming task persists whatever
   * the user has already seen and emits StreamEnd. */
  async stopChatStream(args: StopChatStreamRequest) {
    return (
      await dcsFetch<StopChatStreamResponse>(`/stream/chat/message/stop`, {
        method: 'POST',
        body: JSON.stringify(args),
      })
    ).map((result) => result);
  },

  async listMcpServers() {
    return (
      await dcsFetch<ServerResponse[]>(`/mcp/servers`, { method: 'GET' })
    ).map((result) => result);
  },

  async addMcpServer(args: AddServerRequest) {
    return (
      await dcsFetch<ServerResponse>(`/mcp/servers`, {
        method: 'POST',
        body: JSON.stringify(args),
      })
    ).map((result) => result);
  },

  async updateMcpServer(args: UpdateServerRequest) {
    return (
      await dcsFetch<ServerResponse>(`/mcp/servers`, {
        method: 'PUT',
        body: JSON.stringify(args),
      })
    ).map((result) => result);
  },

  async deleteMcpServer(args: { url: string }) {
    return await dcsFetch(`/mcp/servers?url=${encodeURIComponent(args.url)}`, {
      method: 'DELETE',
    });
  },

  /**
   * Answers with the {@link SIGN_IN_PAGE_REFUSED} error code when the
   * server's sign-in page is not https (HTTP 400).
   */
  async startMcpAuth(args: StartAuthRequest) {
    return (
      await fetchWithToken<StartAuthResponse, typeof SIGN_IN_PAGE_REFUSED>(
        `${dcsHost}/mcp/servers/auth/start`,
        {
          method: 'POST',
          body: JSON.stringify(args),
          errorResponseHandler: async (response) =>
            response.status === 400
              ? {
                  code: SIGN_IN_PAGE_REFUSED,
                  message: "The server's sign-in page is not https",
                }
              : {
                  code: 'HTTP_ERROR',
                  message: `HTTP error! status: ${response.status}`,
                },
        }
      )
    ).map((result) => result);
  },

  async listPipedreamConnections() {
    return (
      await dcsFetch<PipedreamConnectionResponse[]>(
        `/pipedream/mcp/connections`,
        {
          method: 'GET',
        }
      )
    ).map((result) => result);
  },

  async updatePipedreamConnection(args: PipedreamUpdateRequest) {
    return (
      await dcsFetch<PipedreamConnectionResponse>(
        `/pipedream/mcp/connections`,
        {
          method: 'PUT',
          body: JSON.stringify(args),
        }
      )
    ).map((result) => result);
  },

  async deletePipedreamConnection(args: { app_slug: string }) {
    return await dcsFetch(
      `/pipedream/mcp/connections?app_slug=${encodeURIComponent(args.app_slug)}`,
      { method: 'DELETE' }
    );
  },

  /**
   * Start connecting an MCP connector: a Pipedream Connect token, or a
   * Macro Connect URL when the backend routes `app_slug` through Connect.
   * Answers with the {@link PIPEDREAM_DISABLED} error code on deployments
   * where Pipedream isn't configured (HTTP 501).
   */
  async createPipedreamToken(args: PipedreamTokenRequest = {}) {
    return (
      await fetchWithToken<PipedreamTokenResponse, typeof PIPEDREAM_DISABLED>(
        `${dcsHost}/pipedream/mcp/token`,
        {
          method: 'POST',
          body: JSON.stringify(args),
          errorResponseHandler: async (response) => {
            if (response.status === 501) {
              return {
                code: PIPEDREAM_DISABLED,
                message: 'Pipedream is not configured for this deployment',
              };
            }
            return {
              code: 'HTTP_ERROR',
              message: `HTTP error! status: ${response.status}`,
            };
          },
        }
      )
    ).map((result) => result);
  },

  /** Register a connected account reported by the Pipedream Connect UI. */
  async completePipedreamConnection(args: PipedreamCompleteRequest) {
    return (
      await dcsFetch<PipedreamConnectionResponse>(`/pipedream/mcp/complete`, {
        method: 'POST',
        body: JSON.stringify(args),
      })
    ).map((result) => result);
  },

  /**
   * Record an app connected through Macro Connect. Fails with `NOT_FOUND`
   * until Connect lists the connection, so callers poll it.
   */
  async completeMacroConnect(args: PipedreamConnectCompleteRequest) {
    return (
      await dcsFetch<PipedreamConnectionResponse>(
        `/pipedream/mcp/connect/complete`,
        {
          method: 'POST',
          body: JSON.stringify(args),
        }
      )
    ).map((result) => result);
  },

  /**
   * Register an account a Connect flow created but the Connect UI never
   * reported. Fails with `NOT_FOUND` when there is none.
   */
  async recoverPipedreamConnection(args: PipedreamRecoverRequest) {
    return (
      await dcsFetch<PipedreamConnectionResponse>(`/pipedream/mcp/recover`, {
        method: 'POST',
        body: JSON.stringify(args),
      })
    ).map((result) => result);
  },

  /**
   * Browse or search Pipedream apps in popularity order, including their
   * category labels for grouping.
   */
  async browsePipedreamCatalog(args: {
    search?: string;
    cursor?: string;
    limit?: number;
  }) {
    const params = new URLSearchParams();
    if (args.search) params.set('search', args.search);
    if (args.cursor) params.set('cursor', args.cursor);
    if (args.limit) params.set('limit', String(args.limit));
    const query = params.size > 0 ? `?${params}` : '';
    return (
      await dcsFetch<PipedreamCatalogResponse>(
        `/pipedream/mcp/catalog${query}`,
        {
          method: 'GET',
        }
      )
    ).map((result) => result);
  },

  /**
   * Catalog apps that connect through their own MCP server instead of
   * Pipedream; connect them with `startMcpAuth` against `server_url`.
   */
  async listPipedreamOverlays() {
    return (
      await dcsFetch<PipedreamOverlayResponse[]>(`/pipedream/mcp/overlays`, {
        method: 'GET',
      })
    ).map((result) => result);
  },

  async databaseQuery(args: DatabaseQueryRequest) {
    return fetchWithToken<DatabaseQueryAnswer, typeof AI_USAGE_LIMIT_ERROR>(
      `${dcsHost}/database-query`,
      {
        method: 'POST',
        body: JSON.stringify(args),
        errorResponseHandler: aiUsageErrorResponseHandler,
      }
    );
  },

  async structuredCompletion(args: StructuredCompletionRequest) {
    return (
      await fetchWithToken<
        StructuredCompletionResponse,
        typeof AI_USAGE_LIMIT_ERROR
      >(`${dcsHost}/structured-completion`, {
        method: 'POST',
        body: JSON.stringify(args),
        errorResponseHandler: aiUsageErrorResponseHandler,
      })
    ).map((result) => result);
  },
};

export async function generateTitle(text: string): Promise<string | undefined> {
  const result = await dcsCompletion({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: `Generate a concise and informative title that describes the following text. A title should never be longer than 4 words. Respond with only the title, nothing else.\n\n${text}`,
      },
    ],
    max_tokens: 100,
  });

  if (result.isErr()) {
    console.error('Error generating title');
    return undefined;
  }

  return result.value.choices[0]?.message?.content?.trim() || undefined;
}

type DcsCompletionErrorCode = 'NETWORK_ERROR' | 'OPENAI_ERROR';

export async function dcsCompletion(
  body: Omit<OpenAI.ChatCompletionCreateParamsNonStreaming, 'stream'>
): Promise<
  Result<
    OpenAI.ChatCompletion,
    ResultError<FetchWithTokenErrorCode | DcsCompletionErrorCode>[]
  >
> {
  let response: Response;
  try {
    response = await platformFetch(`${dcsHost}/chat/completions`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, stream: false }),
    });
  } catch {
    return err([
      { code: 'NETWORK_ERROR', message: 'Failed to reach completions proxy' },
    ]);
  }

  const data = await response.json();

  if (!response.ok) {
    const message =
      data?.error?.message ??
      `Completion failed with status ${response.status}`;
    return err([{ code: 'OPENAI_ERROR', message: message }]);
  }
  return ok(data as OpenAI.ChatCompletion);
}
