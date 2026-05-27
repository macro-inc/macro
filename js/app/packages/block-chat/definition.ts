import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { AgentModel } from '@service-cognition/generated/schemas';
import type { Entity } from '@service-cognition/generated/schemas/entity';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import { ok } from 'neverthrow';
import BlockChat from './component/Block';

export const DEFAULT_CHAT_NAME = 'New Chat';

export type AttachmentWithoutId = Entity;

export const definition = defineBlock({
  name: 'chat',
  description: '',
  defaultFilename: DEFAULT_CHAT_NAME,
  component: BlockChat,
  liveTrackingEnabled: true,
  async load(source, intent) {
    if (source.type === 'dss') {
      // Fetch the chat from dcs
      const chatId = source.id;
      const res = await cognitionApiServiceClient.getChat({ chat_id: chatId });
      if (
        res.isErr() &&
        res.error.some((error) => error.code === 'UNAUTHORIZED')
      )
        return LoadErrors.INVALID;
      if (res.isErr()) return LoadErrors.MISSING;
      const chat = res.value;

      if (intent === 'preload') {
        return ok({
          type: 'preload',
          origin: source,
        });
      }

      return ok({
        ...chat,
        allModels: Object.values(AgentModel),
        documentMetadata: {
          documentId: chat.chat.id,
          documentName: chat.chat.name,
          documentVersionId: 1,
          owner: chat.chat.userId,
          createdAt: chat.chat.createdAt,
          updatedAt: chat.chat.updatedAt,
          deletedAt: null,
          fileType: 'chat' as any,
        } satisfies DocumentMetadata,
      });
    }

    return LoadErrors.MISSING;
  },
  accepted: {},
});

export type ChatData = ExtractLoadType<(typeof definition)['load']>;
