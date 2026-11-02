import { createCommand, type LexicalCommand } from 'lexical';

// Type definitions
type InsertCommandPayload = {
  equation: string;
  inline: boolean;
};

type UpdateCommandPayload = {
  nodeKey: string;
  equation: string;
};

export const TRY_UPDATE_EQUATION_COMMAND: LexicalCommand<string> =
  createCommand('TRY_UPDATE_EQUATION_COMMAND');

export const UPDATE_EQUATION_COMMAND: LexicalCommand<UpdateCommandPayload> =
  createCommand('UPDATE_EQUATION_COMMAND');

export const TRY_INSERT_EQUATION_COMMAND: LexicalCommand<void> = createCommand(
  'TRY_INSERT_EQUATION_COMMAND'
);

export const INSERT_EQUATION_COMMAND: LexicalCommand<InsertCommandPayload> =
  createCommand('INSERT_EQUATION_COMMAND');
