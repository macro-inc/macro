import { SERVER_HOSTS } from '@core/constant/servers';
import { setCachedInputStore } from '@core/store/cacheChatInput';
import { cache } from '@core/util/cache';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import {
  isErr,
  type MaybeError,
  type MaybeResult,
  mapOk,
  type ObjectLike,
} from '@core/util/maybeResult';
import type { SafeFetchInit } from '@core/util/safeFetch';
import type { DocumentTextPart } from '@service-cognition/generated/schemas/documentTextPart';
import { uuid } from 'short-uuid';
import { waitExtractionStatus } from './extraction';
import type { CreateChatRequest } from './generated/schemas/createChatRequest';
import type { CreateMacroRequest } from './generated/schemas/createMacroRequest';
import { DocumentCognitionServiceApiVersion } from './generated/schemas/documentCognitionServiceApiVersion';
import type { EmptyResponse } from './generated/schemas/emptyResponse';
import type { GetBatchPreviewRequest } from './generated/schemas/getBatchPreviewRequest';
import type { GetBatchPreviewResponse } from './generated/schemas/getBatchPreviewResponse';
import type { GetChatPermissionsResponseV2 } from './generated/schemas/getChatPermissionsResponseV2';
import type { GetChatResponse } from './generated/schemas/getChatResponse';
import type { GetChatsForAttachmentResponse } from './generated/schemas/getChatsForAttachmentResponse';
import type { GetMacroResponse } from './generated/schemas/getMacroResponse';
import type { GetModelsForAttachmentsRequest } from './generated/schemas/getModelsForAttachmentsRequest';
import type { GetModelsForAttachmentsResponse } from './generated/schemas/getModelsForAttachmentsResponse';
import type { GetModelsResponse } from './generated/schemas/getModelsResponse';
import type { MacrosResponse } from './generated/schemas/macrosResponse';
import type { PatchChatRequestV2 } from './generated/schemas/patchChatRequestV2';
import type { PatchMacroRequest } from './generated/schemas/patchMacroRequest';
import type { StringIDResponse } from './generated/schemas/stringIDResponse';
import type { StructedOutputCompletionRequest } from './generated/schemas/structedOutputCompletionRequest';
import type { StructedOutputCompletionResponse } from './generated/schemas/structedOutputCompletionResponse';
import type { SuccessResponse } from './generated/schemas/successResponse';
import type { VerifyAttachmentsRequest } from './generated/schemas/verifyAttachmentsRequest';
import type { VerifyAttachmentsResponse } from './generated/schemas/verifyAttachmentsResponse';
import type { CognitionWebsocketService } from './service';
import {
  createMessageStream,
  sendCognitionWebsocketMessage,
} from './websocket';

const dcsHost: string = SERVER_HOSTS['cognition-service'];

const apiVersions = Object.values(
  DocumentCognitionServiceApiVersion
) satisfies string[];
const latestApiVersion = apiVersions[apiVersions.length - 1];

// NOTE: change this to the version you want to use, defaults to latest
// TODO: @whutchinson98 will update this back to undefined once we've made it so v2 is the default version
const overrideApiVersion: string | undefined = 'v2';

const apiVersion = overrideApiVersion ?? latestApiVersion;
console.log('DCS API version:', apiVersion);

type WithChatId = { chat_id: string };
type WithDocumentId = { document_id: string };
type WithName = { name: string };
type WithProjectId = { project_id: string };
type WithMacroPromptId = { macro_prompt_id: string };

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
  return fetchWithToken<T>(`${dcsHost}/${apiVersion}${url}`, init);
}
export type Success = { success: boolean };

export const cognitionApiServiceClient = {
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
  async getModels() {
    return mapOk(
      await dcsFetch<GetModelsResponse>(`/models`, {
        method: 'GET',
      }),
      (result) => result
    );
  },

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
  async upsertText(args: WithChatId & WithDocumentId & { content: string }) {
    const { content, document_id } = args;
    return await dcsFetch(`/document_text/${document_id}`, {
      method: 'POST',
      body: JSON.stringify({
        content: content,
      }),
    });
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
  async getMacro(args: WithMacroPromptId) {
    const { macro_prompt_id } = args;
    return dcsFetch<GetMacroResponse>(`/macros/${macro_prompt_id}`, {
      method: 'GET',
    });
  },
  async getMacros() {
    return dcsFetch<MacrosResponse>(`/macros`, {
      method: 'GET',
    });
  },
  async getMacroPermissions(args: WithMacroPromptId) {
    const { macro_prompt_id } = args;
    return dcsFetch<GetChatPermissionsResponseV2>(
      `/macros/${macro_prompt_id}/permissions`,
      {
        method: 'GET',
      }
    );
  },
  async createMacro(args: CreateMacroRequest) {
    const { title, prompt, icon, color, requiredDocs } = args;
    return dcsFetch<StringIDResponse>(`/macros`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        prompt,
        icon,
        color,
        requiredDocs,
      }),
    });
  },
  async updateMacro(args: PatchMacroRequest & WithMacroPromptId) {
    const { macro_prompt_id, ...rest } = args;
    return dcsFetch(`/macros/${macro_prompt_id}`, {
      method: 'PATCH',
      body: JSON.stringify(rest),
    });
  },
  async deleteMacro(args: WithMacroPromptId) {
    const { macro_prompt_id } = args;
    return dcsFetch(`/macros/${macro_prompt_id}`, {
      method: 'DELETE',
    });
  },
  async verifyAttachments(args: VerifyAttachmentsRequest) {
    return mapOk(
      await dcsFetch<VerifyAttachmentsResponse>(`/attachments/verify`, {
        method: 'POST',
        body: JSON.stringify(args),
      }),
      (result) => {
        return result;
      }
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
  async structuredOuputCompletion(args: StructedOutputCompletionRequest) {
    return mapOk(
      await dcsFetch<StructedOutputCompletionResponse>(
        `/completions/structured_output`,
        {
          method: 'POST',
          body: JSON.stringify(args),
        }
      ),
      (result) => result as { completion: any }
    );
  },
  async getModelsForAttachments(args: GetModelsForAttachmentsRequest) {
    return mapOk(
      await dcsFetch<GetModelsForAttachmentsResponse>(
        `/attachments/get_models_for_attachments`,
        {
          method: 'POST',
          body: JSON.stringify(args),
        }
      ),
      (result) => result
    );
  },
};

export const cognitionWebsocketServiceClient: CognitionWebsocketService = {
  async stopChatMessage(args) {
    sendCognitionWebsocketMessage({
      ...args,
      type: 'stop_chat_message',
    });
  },
  async selectModel(args) {
    sendCognitionWebsocketMessage({
      ...args,
      type: 'select_model_for_chat',
    });
  },
  async extractionStatus(args) {
    sendCognitionWebsocketMessage({
      ...args,
      type: 'extraction_status',
    });
  },
  /// PDF completion
  async sendCompletion(args) {
    sendCognitionWebsocketMessage({
      ...args,
      type: 'send_completion',
    });
  },

  async streamSimpleCompletion(args) {
    sendCognitionWebsocketMessage({
      ...args,
      type: 'get_simple_completion_stream',
    });
  },

  async editLastMessage(args) {
    sendCognitionWebsocketMessage({
      ...args,
      type: 'edit_chat_message',
      stream_id: uuid(),
    });
  },

  sendStreamChatMessage(args) {
    return createMessageStream({
      ...args,
      type: 'send_chat_message',
      stream_id: uuid(),
    });
  },
  streamEditMessage(args) {
    return createMessageStream({
      ...args,
      type: 'edit_chat_message',
      stream_id: uuid(),
    });
  },

  extractionStatusSync(args) {
    return waitExtractionStatus(args.attachment_id);
  },
};
