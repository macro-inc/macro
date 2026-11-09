import type {
  CommandListener,
  CommandPayloadType,
  SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
} from '../../src/commands';
import type {
  CommandListenerPriority,
  CommandListenerPriorityBefore,
  UpdateTag,
} from '../../src/constants';
import type { LexicalEditor } from '../../src/editor';
import type { LexicalNode } from '../../src/nodes';
import type { BaseSelection } from '../../src/selection';

type Matches<Expected, Actual extends Expected> = Actual;
type ClipboardPayload = CommandPayloadType<
  typeof SELECTION_INSERT_CLIPBOARD_NODES_COMMAND
>;
export type ActualNodePayload = Matches<
  LexicalNode,
  ClipboardPayload['nodes'][number]
>;
export type ActualSelectionPayload = Matches<
  BaseSelection,
  ClipboardPayload['selection']
>;
export type ActualEditorCallback = Matches<
  LexicalEditor,
  Parameters<CommandListener<void>>[1]
>;
export type Priorities = Matches<0 | 1 | 2 | 3 | 4, CommandListenerPriority>;
export type BeforePriorities = Matches<
  -8 | -7 | -6 | -5 | -4,
  CommandListenerPriorityBefore
>;
export type ArbitraryTag = Matches<UpdateTag, 'custom-tag'>;
