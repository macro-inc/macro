/** Command identity and payloads stay in JS; only editor transactions use Rust. */

import type {
  CommandListener,
  CommandPayloadType,
  LexicalCommand,
} from '../commands';
import { commandBucket } from '../compatibility-exceptions';
import type {
  CommandListenerPriority,
  CommandListenerPriorityBefore,
} from '../constants';
import { type LexicalEditor, updateEditorSync } from '../editor';
import { DequeSet } from './deque-set';
import type { CommandBucket } from './types';

/** The sole typed lookup for the registry's command/payload association. */
function lookup<P>(
  editor: LexicalEditor,
  command: LexicalCommand<P>
): CommandBucket<P> {
  return commandBucket(editor._commands, command);
}

export function registerCommand<P>(
  editor: LexicalEditor,
  command: LexicalCommand<P>,
  listener: CommandListener<P>,
  priority: CommandListenerPriority | CommandListenerPriorityBefore
): () => void {
  if (priority === undefined)
    throw new Error('Listener for type "command" requires a "priority".');
  const commands = editor._commands;
  if (!commands.has(command)) {
    commands.set(command, [
      new DequeSet(),
      new DequeSet(),
      new DequeSet(),
      new DequeSet(),
      new DequeSet(),
    ]);
  }
  const bucket = lookup(editor, command);
  const normalized = priority & 7;
  const listeners = bucket[normalized];
  if (listeners === undefined) throw new TypeError('Invalid command priority');
  if (normalized !== priority) listeners.addFront(listener);
  else listeners.addBack(listener);
  return () => {
    listeners.delete(listener);
    if (bucket.every((entry) => entry.size === 0)) commands.delete(command);
  };
}

export function dispatchCommand<TCommand extends LexicalCommand<unknown>>(
  editor: LexicalEditor,
  command: TCommand,
  payload: CommandPayloadType<TCommand>,
  fromEditor: LexicalEditor = editor
): boolean {
  const editors: LexicalEditor[] = [];
  for (
    let current: LexicalEditor | null = editor;
    current !== null;
    current = current._parentEditor
  )
    editors.push(current);
  let updatingParent: LexicalEditor | undefined;
  for (let priority = 4; priority >= 0; priority--) {
    for (let index = 0; index < editors.length; index++) {
      const current = editors[index];
      if (index > 0 && current._updating) {
        updatingParent = current;
        break;
      }
      if (!current._commands.has(command)) continue;
      const listeners = lookup<CommandPayloadType<TCommand>>(current, command)[
        priority
      ];
      if (listeners.size === 0) continue;
      let handled = false;
      updateEditorSync(current, () => {
        for (const listener of listeners) {
          if (listener(payload, fromEditor)) {
            handled = true;
            return;
          }
        }
      });
      if (handled) return true;
    }
  }
  if (updatingParent) {
    const parent = updatingParent;
    parent.update(() => {
      dispatchCommand(parent, command, payload, fromEditor);
    });
  }
  return false;
}
