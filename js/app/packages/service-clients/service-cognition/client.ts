import { SERVER_HOSTS } from '@core/constant/servers';
import { setCachedInputStore } from '@core/store/cacheChatInput';
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
import type { AddServerRequest } from './generated/schemas/addServerRequest';
import type { CreateChatRequest } from './generated/schemas/createChatRequest';
import type { GetBatchPreviewRequest } from './generated/schemas/getBatchPreviewRequest';
import type { GetBatchPreviewResponse } from './generated/schemas/getBatchPreviewResponse';
import type { GetChatPermissionsResponse } from './generated/schemas/getChatPermissionsResponse';
import type { GetChatResponse } from './generated/schemas/getChatResponse';
import type { GetChatsForAttachmentResponse } from './generated/schemas/getChatsForAttachmentResponse';
import type { HttpSendChatMessageRequest } from './generated/schemas/httpSendChatMessageRequest';
import type { PatchChatRequest } from './generated/schemas/patchChatRequest';
import type { SendChatMessageResponse } from './generated/schemas/sendChatMessageResponse';
import type { ServerResponse } from './generated/schemas/serverResponse';
import type { StartAuthRequest } from './generated/schemas/startAuthRequest';
import type { StartAuthResponse } from './generated/schemas/startAuthResponse';
import type { StopChatStreamRequest } from './generated/schemas/stopChatStreamRequest';
import type { StopChatStreamResponse } from './generated/schemas/stopChatStreamResponse';
import type { StringIDResponse } from './generated/schemas/stringIDResponse';
import type { StructuredCompletionRequest } from './generated/schemas/structuredCompletionRequest';
import type { StructuredCompletionResponse } from './generated/schemas/structuredCompletionResponse';
import type { UpdateServerRequest } from './generated/schemas/updateServerRequest';
import type * as toolTypes from './generated/tools/tool.ts';

type ToolCallArgs = {
  [K in toolTypes.ToolName]: toolTypes.NamedTool<K, 'call'>['data'];
};
type ToolResponseArgs = {
  [K in toolTypes.ToolName]: toolTypes.NamedTool<K, 'response'>['data'];
};

const dcsHost: string = SERVER_HOSTS['cognition-service'];

type WithChatId = { chat_id: string };
type WithName = { name: string };
type WithProjectId = { project_id: string };

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
type Success = { success: boolean };

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

  async editChatProject(args: WithChatId & WithProjectId) {
    const { chat_id, project_id } = args;
    return (
      await dcsFetch<{ success: boolean }>(`/chats/${chat_id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          projectId: project_id,
        }),
      })
    ).map(() => ({ success: true }));
  },

  async updateChatPermissions(args: PatchChatRequest & WithChatId) {
    const { chat_id, sharePermission } = args;
    return await dcsFetch(`/chats/${chat_id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        sharePermission,
      }),
    });
  },
  async renameChat(args: WithChatId & { new_name: string }) {
    const { chat_id, new_name } = args;
    return (
      await dcsFetch<{ success: boolean }>(`/chats/${chat_id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: new_name,
        }),
      })
    ).map(() => ({ success: true }));
  },
  async copyChat(args: WithChatId & WithName) {
    const { chat_id, name } = args;
    return (
      await dcsFetch<StringIDResponse>(`/chats/${chat_id}/copy`, {
        method: 'POST',
        body: JSON.stringify({
          name,
        }),
      })
    ).map((result) => result);
  },
  async createChat(args: CreateChatRequest) {
    return (
      await dcsFetch<StringIDResponse>(`/chats`, {
        method: 'POST',
        body: JSON.stringify({
          name: args.name,
          projectId: args.projectId,
        }),
      })
    ).map((result) => result);
  },
  async deleteChat(args: WithChatId) {
    const { chat_id } = args;
    const result = await dcsFetch(`/chats/${chat_id}`, {
      method: 'DELETE',
    });

    setCachedInputStore(chat_id, undefined);

    // delete chat returns a 200 with an empty body on success
    // which return INVALID_JSON error on response.json()
    // so we return no error instead to signal success
    if (
      result.isErr() &&
      result.error.some((error) => error.code === 'INVALID_JSON')
    )
      result;

    return result;
  },
  async getChatPermissions(args: { id: string }) {
    const { id } = args;
    return (
      await dcsFetch<GetChatPermissionsResponse>(`/chats/${id}/permissions`, {
        method: 'GET',
      })
    ).map((result) => result.permissions);
  },
  async permanentlyDeleteChat(args: WithChatId) {
    const { chat_id } = args;

    setCachedInputStore(chat_id, undefined);

    return await dcsFetch(`/chats/${chat_id}/permanent`, {
      method: 'DELETE',
    });
  },
  async revertDeleteChat(args: WithChatId) {
    const { chat_id } = args;
    return (
      await dcsFetch<Success>(`/chats/${chat_id}/revert_delete`, {
        method: 'PUT',
      })
    ).map((result) => result);
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
  /** Update a tool call's arguments (validates against tool schema server-side). */
  async updateToolCall<T extends keyof ToolCallArgs>(args: {
    chat_id: string;
    messageId: string;
    toolCallId: string;
    args: ToolCallArgs[T];
  }) {
    return await dcsFetch(`/chats/${args.chat_id}/tool/update`, {
      method: 'POST',
      body: JSON.stringify({
        messageId: args.messageId,
        toolCallId: args.toolCallId,
        args: args.args,
      }),
    });
  },

  /** Update a tool response. */
  async updateToolResponse<T extends keyof ToolResponseArgs>(args: {
    chat_id: string;
    messageId: string;
    toolCallId: string;
    response: ToolResponseArgs[T];
  }) {
    return await dcsFetch(`/chats/${args.chat_id}/tool/response/update`, {
      method: 'POST',
      body: JSON.stringify({
        messageId: args.messageId,
        toolCallId: args.toolCallId,
        response: args.response,
      }),
    });
  },

  /** Execute a pending tool call, optionally with updated arguments. */
  async callTool<T extends keyof ToolCallArgs>(args: {
    chat_id: string;
    messageId: string;
    toolCallId: string;
    args?: ToolCallArgs[T];
  }) {
    return (
      await dcsFetch<{ result: unknown }>(`/chats/${args.chat_id}/tool/call`, {
        method: 'POST',
        body: JSON.stringify({
          messageId: args.messageId,
          toolCallId: args.toolCallId,
          args: args.args,
        }),
      })
    ).map((result) => result.result);
  },

  /** Reject a pending tool call. */
  async rejectToolCall(args: {
    chat_id: string;
    messageId: string;
    toolCallId: string;
  }) {
    return await dcsFetch(`/chats/${args.chat_id}/tool/reject`, {
      method: 'POST',
      body: JSON.stringify({
        messageId: args.messageId,
        toolCallId: args.toolCallId,
      }),
    });
  },

  /** Send a chat message via HTTP stream API. Response chunks arrive via connection_gateway. */
  async sendStreamChatMessage(args: HttpSendChatMessageRequest) {
    return (
      await dcsFetch<SendChatMessageResponse>(`/stream/chat/message`, {
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

  async startMcpAuth(args: StartAuthRequest) {
    return (
      await dcsFetch<StartAuthResponse>(`/mcp/servers/auth/start`, {
        method: 'POST',
        body: JSON.stringify(args),
      })
    ).map((result) => result);
  },

  async structuredCompletion(args: StructuredCompletionRequest) {
    return (
      await dcsFetch<StructuredCompletionResponse>(`/structured-completion`, {
        method: 'POST',
        body: JSON.stringify(args),
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
