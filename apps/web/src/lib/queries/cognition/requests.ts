import { cognitionApiServiceClient } from '@service-cognition/client';

export const createChat: typeof cognitionApiServiceClient.createChat = (
  ...args
) => cognitionApiServiceClient.createChat(...args);

export const sendChatMessage: typeof cognitionApiServiceClient.sendStreamChatMessage =
  (...args) => cognitionApiServiceClient.sendStreamChatMessage(...args);

export const stopChatStream: typeof cognitionApiServiceClient.stopChatStream = (
  ...args
) => cognitionApiServiceClient.stopChatStream(...args);

export const fetchChatIdMapping: typeof cognitionApiServiceClient.getIdMapping =
  (...args) => cognitionApiServiceClient.getIdMapping(...args);

export const createChatIdMapping: typeof cognitionApiServiceClient.createIdMapping =
  (...args) => cognitionApiServiceClient.createIdMapping(...args);

export const updateChatToolCall: typeof cognitionApiServiceClient.updateToolCall =
  (...args) => cognitionApiServiceClient.updateToolCall(...args);

export const executeChatTool: typeof cognitionApiServiceClient.callTool = (
  ...args
) => cognitionApiServiceClient.callTool(...args);

export const rejectChatToolCall: typeof cognitionApiServiceClient.rejectToolCall =
  (...args) => cognitionApiServiceClient.rejectToolCall(...args);

export const updateChatToolResponse: typeof cognitionApiServiceClient.updateToolResponse =
  (...args) => cognitionApiServiceClient.updateToolResponse(...args);

export const fetchChatCitation = (
  ...args: Parameters<typeof cognitionApiServiceClient.getCitation>
): ReturnType<typeof cognitionApiServiceClient.getCitation> =>
  cognitionApiServiceClient.getCitation(...args);

export const fetchChatPermissions: typeof cognitionApiServiceClient.getChatPermissions =
  (...args) => cognitionApiServiceClient.getChatPermissions(...args);

export const updateChatPermissions: typeof cognitionApiServiceClient.updateChatPermissions =
  (...args) => cognitionApiServiceClient.updateChatPermissions(...args);
