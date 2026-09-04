/**
 * A Macro tool the fold recognized by name — reached over Macro's MCP
 * server, or called natively by Macro's own agent.
 *
 * The fold has already named the tool and removed any MCP envelope, so
 * `detail.input` / `detail.output` are the tool's own JSON. When the chat
 * block has a component for that tool, it renders here with that JSON — the
 * same chip a chat shows for `ReadContent`, `ListEntities`, `CreateDocument`
 * and the rest. The chat renderer validates the JSON against the tool's
 * schema and shows nothing for a shape it does not know; then, or when a
 * chat component assumes chat context it does not have here, the card falls
 * back to a labelled row with the JSON.
 */

import { RenderTool } from '@core/component/AI/component/tool/handler';
import type { ToolDetail } from '@service-agent-fold/generated/types';
import {
  deserializeToolCall,
  deserializeToolResponse,
} from '@service-cognition/generated/tools/tool';
import { createMemo, ErrorBoundary, type JSX, Show } from 'solid-js';
import { FoldedOutput, ToolCard } from '../../ui';
import type { ToolCallCommon, ToolCallContext } from './shared';

type MacroDetail = Extract<ToolDetail, { kind: 'macro' }>;

export function MacroToolCall(props: {
  detail: MacroDetail;
  common: ToolCallCommon;
  context?: ToolCallContext;
}): JSX.Element {
  const finished = () =>
    props.common.status === 'completed' || props.common.status === 'failed';
  // The chat renderer renders nothing for a tool it has no component for or
  // arguments that do not fit the tool's schema, and it shows a *completed*
  // call whose response it cannot read as failed. A call it would drop or
  // misreport keeps the generic card, so no row vanishes or lies.
  const chatRenders = createMemo(() => {
    if (props.detail.error != null) return false;
    const call = deserializeToolCall({
      id: props.common.id,
      name: props.common.label,
      json: props.detail.input,
    });
    if (call.isErr()) return false;
    if (props.common.status !== 'completed') return true;
    return deserializeToolResponse({
      id: props.common.id,
      name: props.common.label,
      json: props.detail.output,
    }).isOk();
  });

  return (
    <Show when={chatRenders()} fallback={<GenericMacroToolCall {...props} />}>
      <ErrorBoundary fallback={<GenericMacroToolCall {...props} />}>
        <RenderTool
          tool_id={props.common.id}
          name={props.common.label}
          json={props.detail.input}
          response={
            props.detail.output == null
              ? undefined
              : { json: props.detail.output, name: props.common.label }
          }
          chat_id={props.context?.sessionId ?? ''}
          message_id={props.context?.messageId ?? ''}
          part_index={props.context?.partIndex ?? 0}
          isComplete={finished()}
          renderContext={{
            renderContext: { isStreaming: !finished(), grouped: false },
          }}
        />
      </ErrorBoundary>
    </Show>
  );
}

/** The labelled row with the tool's own JSON, for a tool the chat has no component for. */
function GenericMacroToolCall(props: {
  detail: MacroDetail;
  common: ToolCallCommon;
}): JSX.Element {
  const body = () => {
    const sections: string[] = [];
    if (props.detail.input != null) {
      sections.push(JSON.stringify(props.detail.input, null, 2));
    }
    if (props.detail.error != null) {
      sections.push(props.detail.error);
    } else if (props.detail.output != null) {
      sections.push(JSON.stringify(props.detail.output, null, 2));
    }
    return sections.join('\n\n');
  };

  return (
    <ToolCard
      title={props.common.label}
      subtitle={props.detail.error ?? undefined}
      status={props.common.status}
      muted={props.common.muted}
      trailing={props.common.trailing}
    >
      <Show when={body()}>{(text) => <FoldedOutput text={text()} />}</Show>
    </ToolCard>
  );
}
