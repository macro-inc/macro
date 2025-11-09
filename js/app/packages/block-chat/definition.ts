import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { isErr, ok } from '@core/util/maybeResult';
import { AllModels } from '@service-cognition/generated/schemas';
import type { ChatAttachmentWithName } from '@service-cognition/generated/schemas/chatAttachmentWithName';
import { storageServiceClient } from '@service-storage/client';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import { cognitionApiServiceClient } from 'service-cognition/client';
import BlockChat from './component/Block';

export type AttachmentWithoutId = Omit<ChatAttachmentWithName, 'id'>;
export const definition = defineBlock({
  name: 'chat',
  description: '',
  defaultFilename: 'New Chat',
  component: BlockChat,
  async load(source, intent) {
    if (source.type === 'dss') {
      // Fetch the chat from dcs
      const chatId = source.id;
      const res = await cognitionApiServiceClient.getChat({ chat_id: chatId });
      if (isErr(res, 'UNAUTHORIZED')) return LoadErrors.INVALID;
      if (isErr(res)) return LoadErrors.MISSING;
      const [, chat] = res;

      if (intent === 'preload') {
        return ok({
          type: 'preload',
          origin: source,
        });
      }

      storageServiceClient
        .trackOpenedChat({
          chatId: source.id,
        })
        .catch((err) => console.error(err));

      return ok({
        ...chat,
        allModels: AllModels, // TODO maybe limit people with something more swag based on acoun
        isPersistent: chat.chat.isPersistent,
        documentMetadata: {
          documentId: chat.chat.id,
          documentName: chat.chat.name,
          documentVersionId: 1,
          owner: chat.chat.userId,
          createdAt: chat.chat.createdAt,
          updatedAt: chat.chat.updatedAt,
          fileType: 'chat' as any,
        } satisfies DocumentMetadata,
      });
    }

    return LoadErrors.MISSING;
  },
  accepted: {},
});

export type ChatData = ExtractLoadType<(typeof definition)['load']>;
