import { SERVER_HOSTS } from '@core/constant/servers';
import { setCachedInputStore } from '@core/store/cacheChatInput';
import { cache } from '@core/util/cache';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import {
  err,
  isErr,
  type MaybeError,
  type MaybeResult,
  mapOk,
  type ObjectLike,
  ok,
} from '@core/util/maybeResult';
import { platformFetch } from '@core/util/platformFetch';
import type { SafeFetchInit } from '@core/util/safeFetch';
import type { DocumentTextPart } from '@service-cognition/generated/schemas/documentTextPart';
import type OpenAI from 'openai';
import type { CreateChatRequest } from './generated/schemas/createChatRequest';
import type { EmptyResponse } from './generated/schemas/emptyResponse';
import type { GetBatchPreviewRequest } from './generated/schemas/getBatchPreviewRequest';
import type { GetBatchPreviewResponse } from './generated/schemas/getBatchPreviewResponse';
import type { GetChatPermissionsResponseV2 } from './generated/schemas/getChatPermissionsResponseV2';
import type { GetChatResponse } from './generated/schemas/getChatResponse';
import type { GetChatsForAttachmentResponse } from './generated/schemas/getChatsForAttachmentResponse';
import type { HttpSendChatMessageRequest } from './generated/schemas/httpSendChatMessageRequest';
import type { PatchChatRequestV2 } from './generated/schemas/patchChatRequestV2';
import type { SendChatMessageResponse } from './generated/schemas/sendChatMessageResponse';
import type { StringIDResponse } from './generated/schemas/stringIDResponse';
import type { SuccessResponse } from './generated/schemas/successResponse';

const dcsHost: string = SERVER_HOSTS['cognition-service'];

type WithChatId = { chat_id: string };
type WithName = { name: string };
type WithProjectId = { project_id: string };

export function dcsFetch(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeError<FetchWithTokenErrorCode>>;
export function dcsFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeResult<FetchWithTokenErrorCode, T>>;
export function dcsFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<MaybeResult<FetchWithTokenErrorCode, T>>
  | Promise<MaybeError<FetchWithTokenErrorCode>> {
  return fetchWithToken<T>(`${dcsHost}${url}`, init);
}
export type Success = { success: boolean };

type IdMappingResponse = { target_id: string | null };

export const cognitionApiServiceClient = {
  /** Creates a mapping from source_id to target_id */
  async createIdMapping(args: { source_id: string; target_id: string }) {
    const { source_id, target_id } = args;
    return mapOk(
      await dcsFetch<{ success: boolean }>(`/id_mapping/${source_id}`, {
        method: 'POST',
        body: JSON.stringify({ target_id }),
      }),
      (result) => result
    );
  },

  /** Gets the target_id for a given source_id */
  async getIdMapping(args: { source_id: string }) {
    const { source_id } = args;
    return mapOk(
      await dcsFetch<IdMappingResponse>(`/id_mapping/${source_id}`, {
        method: 'GET',
      }),
      (result) => result.target_id
    );
  },

  getChat: cache(
    async function getChat(args: WithChatId) {
      const { chat_id } = args;
      return mapOk(
        await dcsFetch<GetChatResponse>(`/chats/${chat_id}`, {
          method: 'GET',
        }),
        (result) => result
      );
    },
    {
      seconds: 5,
    }
  ),

  async editChatProject(args: WithChatId & WithProjectId) {
    const { chat_id, project_id } = args;
    return mapOk(
      await dcsFetch<{ success: boolean }>(`/chats/${chat_id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          projectId: project_id,
        }),
      }),
      () => ({ success: true })
    );
  },

  async updateChatPermissions(args: PatchChatRequestV2 & WithChatId) {
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
    return mapOk(
      await dcsFetch<{ success: boolean }>(`/chats/${chat_id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: new_name,
        }),
      }),
      () => ({ success: true })
    );
  },
  async copyChat(args: WithChatId & WithName) {
    const { chat_id, name } = args;
    return mapOk(
      await dcsFetch<StringIDResponse>(`/chats/${chat_id}/copy`, {
        method: 'POST',
        body: JSON.stringify({
          name,
        }),
      }),
      (result) => result
    );
  },
  async createChat(args: CreateChatRequest) {
    return mapOk(
      await dcsFetch<StringIDResponse>(`/chats`, {
        method: 'POST',
        body: JSON.stringify({
          name: args.name,
          model: args.model,
          projectId: args.projectId,
          attachments: args.attachments,
          isPersistent: args.isPersistent,
        }),
      }),
      (result) => result
    );
  },
  async deleteChat(args: WithChatId) {
    const { chat_id } = args;
    const maybeResult = await dcsFetch(`/chats/${chat_id}`, {
      method: 'DELETE',
    });

    setCachedInputStore(chat_id, undefined);

    // delete chat returns a 200 with an empty body on success
    // which return INVALID_JSON error on response.json()
    // so we return no error instead to signal success
    if (isErr(maybeResult, 'INVALID_JSON')) maybeResult;

    return maybeResult;
  },
  async getChatPermissions(args: { id: string }) {
    const { id } = args;
    return mapOk(
      await dcsFetch<GetChatPermissionsResponseV2>(`/chats/${id}/permissions`, {
        method: 'GET',
      }),
      (result) => result.permissions
    );
  },
  async permanentlyDeleteChat(args: WithChatId) {
    const { chat_id } = args;

    setCachedInputStore(chat_id, undefined);

    return mapOk(
      await dcsFetch<EmptyResponse>(`/chats/${chat_id}/permanent`, {
        method: 'DELETE',
      }),
      () => ({})
    );
  },
  async revertDeleteChat(args: WithChatId) {
    const { chat_id } = args;
    return mapOk(
      await dcsFetch<SuccessResponse>(`/chats/${chat_id}/revert_delete`, {
        method: 'PUT',
      }),
      (result) => result
    );
  },
  async getChatsForAttachment(args: { attachment_id: string }) {
    const { attachment_id } = args;
    return mapOk(
      await dcsFetch<GetChatsForAttachmentResponse>(
        `/attachments/${attachment_id}/chats`,
        {
          method: 'GET',
        }
      ),
      (result) => result
    );
  },

  getCitation: cache(
    async function getCitation(args) {
      return mapOk(
        await dcsFetch<DocumentTextPart>(`/citations/${args.id}`),
        (result) => result
      );
    },
    {
      forever: true,
    }
  ),
  async getBatchChatPreviews(args: GetBatchPreviewRequest) {
    return mapOk(
      await dcsFetch<GetBatchPreviewResponse>(`/preview`, {
        method: 'POST',
        body: JSON.stringify(args),
      }),
      (result) => result
    );
  },
  /** Send a chat message via HTTP stream API. Response chunks arrive via connection_gateway. */
  async sendStreamChatMessage(args: HttpSendChatMessageRequest) {
    return mapOk(
      await dcsFetch<SendChatMessageResponse>(`/stream/chat/message`, {
        method: 'POST',
        body: JSON.stringify(args),
      }),
      (result) => result
    );
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

  if (isErr(result)) {
    console.error('Error generating title');
    return undefined;
  }

  return result[1].choices[0]?.message?.content?.trim() || undefined;
}

type DcsCompletionErrorCode = 'NETWORK_ERROR' | 'OPENAI_ERROR';

export async function dcsCompletion(
  body: Omit<OpenAI.ChatCompletionCreateParamsNonStreaming, 'stream'>
): Promise<
  MaybeResult<
    FetchWithTokenErrorCode | DcsCompletionErrorCode,
    OpenAI.ChatCompletion
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
    return err('NETWORK_ERROR', 'Failed to reach completions proxy');
  }

  const data = await response.json();

  if (!response.ok) {
    const message =
      data?.error?.message ??
      `Completion failed with status ${response.status}`;
    return err('OPENAI_ERROR', message);
  }
  return ok(data as OpenAI.ChatCompletion);
}
