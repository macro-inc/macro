import { isMagicChipMessage, isMagicChipStatus } from '@macro-inc/lexical-core';
import type { JsonObject } from '@macro-inc/lexical-wasm-view/view/types';
import type { MagicChipUIData } from '../component/decorator/MagicChip/types';

/** Project actual Source/native data without constructing a model or view node. */
export function projectMagicChipData(value: JsonObject): MagicChipUIData {
  const message = value.promptedMessage;
  if (
    typeof value.agentSessionId !== 'string' ||
    (value.channelId !== undefined &&
      value.channelId !== null &&
      typeof value.channelId !== 'string') ||
    !isMagicChipStatus(value.status) ||
    (message !== undefined &&
      message !== null &&
      !Array.isArray(message) &&
      !isMagicChipMessage(message))
  )
    throw new Error('Invalid magic chip payload');
  return {
    agentSessionId: value.agentSessionId,
    ...(value.channelId === undefined ? {} : { channelId: value.channelId }),
    promptedMessage: message,
    status: value.status,
  };
}
