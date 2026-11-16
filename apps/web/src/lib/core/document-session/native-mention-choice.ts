import type { LexicalCommand } from 'lexical';
import { z } from 'zod';
import bridgeSchema from '../../../../tauri/native_editor_plugin/schema/bridge.schema.json';
import {
  INSERT_AGENT_SESSION_MENTION_COMMAND,
  INSERT_BOOKING_LINK_MENTION_COMMAND,
  INSERT_DATE_MENTION_COMMAND,
  INSERT_DOCUMENT_MENTION_COMMAND,
  INSERT_GROUP_MENTION_COMMAND,
  INSERT_USER_MENTION_COMMAND,
  REMOVE_INLINE_SEARCH_COMMAND,
} from '../component/LexicalMarkdown/plugins/mentions';
import type { MenuChoice } from './generated/native-bridge';

const choiceSchema = z.fromJSONSchema({
  $schema: 'http://json-schema.org/draft-07/schema#',
  definitions: bridgeSchema.definitions,
  $ref: '#/definitions/MenuChoice',
});

// The same schema generates the wire types and validates this in-process command boundary.
function isChoice(value: unknown): value is MenuChoice {
  return choiceSchema.safeParse(value).success;
}

/** Interpret only the existing typed mention commands; no editor or callback crosses JNI. */
export function nativeMentionChoice(
  command: LexicalCommand<unknown>,
  payload: unknown
): MenuChoice | undefined {
  if (command === REMOVE_INLINE_SEARCH_COMMAND) return undefined;
  let choice: unknown;
  switch (command) {
    case INSERT_USER_MENTION_COMMAND:
      choice = { kind: 'user', user: payload };
      break;
    case INSERT_DOCUMENT_MENTION_COMMAND:
      choice = { kind: 'document', document: payload };
      break;
    case INSERT_DATE_MENTION_COMMAND:
      choice = { kind: 'date', date: payload };
      break;
    case INSERT_AGENT_SESSION_MENTION_COMMAND:
      choice = { kind: 'agent-session', agentSession: payload };
      break;
    case INSERT_BOOKING_LINK_MENTION_COMMAND:
      choice = { kind: 'booking-link', bookingLink: payload };
      break;
    case INSERT_GROUP_MENTION_COMMAND:
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('groupAlias' in payload)
      )
        throw new Error('Invalid native group mention');
      choice = { kind: 'group', groupAlias: payload.groupAlias };
      break;
    default:
      throw new Error('Unsupported native mention command');
  }
  if (!isChoice(choice)) throw new Error('Invalid native mention payload');
  return choice;
}
