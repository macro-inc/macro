import { codeExecutionInput } from '@app/features/block-agent/state/code-execution';
import { isCodeExecution } from '@app/features/block-agent/state/tool-groups';
import type { AgentActivityRow } from '@macro-inc/lexical-core';
import { agentCodeExecutionQueryOptions } from '@queries/agent-session/code-execution';
import type {
  ActivityCard,
  ActivityRow,
  FoldedMessage,
} from '@service-agent-fold/generated/types';
import type { ActivityItem } from '@service-agent-harness/generated/schemas';
import { useQueries } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';

/** Share the session view's observed SDK activity while an inline run is open. */
export function createCodeActivityRows(
  sessionId: Accessor<string>,
  reply: Accessor<FoldedMessage | undefined>,
  segment: Accessor<number>,
  rows: Accessor<readonly (ActivityRow | AgentActivityRow)[]>
) {
  const calls = createMemo(() => {
    const message = reply();
    const range = message?.segments.find((item) => item.index === segment());
    if (!message || !range) return [];
    return message.parts.slice(range.start, range.end).flatMap((part) => {
      if (
        !isCodeExecution(part) ||
        part.kind !== 'tool_use' ||
        part.status === 'pending'
      )
        return [];
      const input = codeExecutionInput(part);
      return input ? [{ ...input, id: part.id }] : [];
    });
  });
  const queries = useQueries(() => ({
    queries: calls().map((call) =>
      agentCodeExecutionQueryOptions(sessionId(), call.executionId)
    ),
  }));
  return () => {
    const replacements = new Map<string, ActivityRow[]>();
    calls().forEach((call, index) => {
      const query = queries[index];
      const record = query && !query.isPending ? query.data : undefined;
      const activity =
        record?.source === call.source ? record.activity : undefined;
      if (!activity?.length) return;
      replacements.set(
        call.id,
        activity.map((item) => ({
          id: `${call.id}:${item.id}`,
          label: item.label,
          detail: null,
          status:
            item.status === 'unknown' ||
            (item.status === 'running' && reply()?.stop !== null)
              ? 'interrupted'
              : item.status,
          card:
            item.status === 'completed' && item.item
              ? itemCard(item.item)
              : null,
        }))
      );
    });
    return rows().flatMap((row) => replacements.get(row.id) ?? [row]);
  };
}

/**
 * The card a completed write earns while the run is open: the one the fold
 * gives its step once the run's result lands, so it stays put.
 */
function itemCard(item: ActivityItem): ActivityCard {
  return {
    kind: 'item',
    itemType: item.type,
    itemId: item.id,
    fileType: null,
    action: item.action,
    title: item.title ?? null,
    summary: null,
  };
}
