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
import type { CatalogPage } from './generated/schemas/catalogPage';
import type { ConnectStep } from './generated/schemas/connectStep';
import type { Connector } from './generated/schemas/connector';
import type { UpdateConnectorRequest } from './generated/schemas/updateConnectorRequest';
import type { DatabaseQueryAnswer } from './generated/schemas/databaseQueryAnswer';
import type { DatabaseQueryRequest } from './generated/schemas/databaseQueryRequest';
import type { GetBatchPreviewRequest } from './generated/schemas/getBatchPreviewRequest';
import type { GetBatchPreviewResponse } from './generated/schemas/getBatchPreviewResponse';
import type { GetChatPermissionsResponse } from './generated/schemas/getChatPermissionsResponse';
import type { GetChatResponse } from './generated/schemas/getChatResponse';
import type { GetChatsForAttachmentResponse } from './generated/schemas/getChatsForAttachmentResponse';
import type { StopChatStreamRequest } from './generated/schemas/stopChatStreamRequest';
import type { StopChatStreamResponse } from './generated/schemas/stopChatStreamResponse';
import type { StructuredCompletionRequest } from './generated/schemas/structuredCompletionRequest';
import type { StructuredCompletionResponse } from './generated/schemas/structuredCompletionResponse';

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

  /** Every app and server the user holds, with where they stand. */
  async listConnectors() {
    return (await dcsFetch<Connector[]>(`/connectors`, { method: 'GET' })).map(
      (result) => result
    );
  },

  /** Add a server by URL; one at an app's address comes back as that app. */
  async addConnectorServer(args: AddServerRequest) {
    return (
      await dcsFetch<Connector>(`/connectors`, {
        method: 'POST',
        body: JSON.stringify(args),
      })
    ).map((result) => result);
  },

  /** Browse or search the apps the user can connect, most popular first. */
  async browseConnectorCatalog(args: {
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
      await dcsFetch<CatalogPage>(`/connectors/catalog${query}`, {
        method: 'GET',
      })
    ).map((result) => result);
  },

  /**
   * Begin connecting an app, or signing in to a server added by URL. `key`
   * is a connector key (`app/{slug}` or `server/{id}`), which is URL-safe.
   */
  async startConnectorConnect(args: { key: string }) {
    return (
      await dcsFetch<ConnectStep>(`/connectors/${args.key}/connect`, {
        method: 'POST',
      })
    ).map((result) => result);
  },

  /**
   * Record the connection the user just made. Fails with `NOT_FOUND` until
   * it exists, so callers poll it while the connect page is open.
   */
  async completeConnectorConnect(args: { key: string }) {
    return (
      await dcsFetch<Connector>(`/connectors/${args.key}/complete`, {
        method: 'POST',
      })
    ).map((result) => result);
  },

  /** Turn a connection on or off, or rename it. */
  async updateConnector(args: { key: string } & UpdateConnectorRequest) {
    const { key, ...body } = args;
    return await dcsFetch(`/connectors/${key}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  /** Remove a connection; removing GitHub unlinks the account. */
  async removeConnector(args: { key: string }) {
    return await dcsFetch(`/connectors/${args.key}`, { method: 'DELETE' });
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
