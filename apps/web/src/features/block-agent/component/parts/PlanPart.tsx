/** The agent's working todo list for the turn, in the library's TodoList. */

import type { MessagePart } from '@service-agent-fold/generated/types';
import { TodoList } from '../../ui';

export function PlanPart(props: {
  part: Extract<MessagePart, { kind: 'plan' }>;
}) {
  return (
    <TodoList
      todos={props.part.entries.map((entry) => ({
        content: entry.content,
        status: entry.status,
      }))}
    />
  );
}
