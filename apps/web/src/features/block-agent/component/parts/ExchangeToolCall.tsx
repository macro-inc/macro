/**
 * The card for a call the fold has no special rendering for: a tool on an
 * MCP server it does not know, a harness tool this block does not model,
 * ACP's `switch_mode`. What there is to show is the exchange itself - the
 * arguments the agent sent and the result it got - so the body is those,
 * labelled, as JSON.
 *
 * An MCP tool shows its server beside its name (`ReadContent · macro`), the
 * way the chat block's MCP row does; a failed call keeps the fold's error
 * text as its subtitle, the chat block's failed-tool treatment.
 */

import type { ToolDetail } from '@service-agent-fold/generated/types';
import type { JSX } from 'solid-js';
import { FoldedExchange, ToolCard } from '../../ui';
import type { ToolCallCommon } from './shared';

type ExchangeDetail = Extract<ToolDetail, { kind: 'other' }>;

export function ExchangeToolCall(props: {
  detail: ExchangeDetail;
  common: ToolCallCommon;
}): JSX.Element {
  const hasContent = () =>
    props.detail.input != null ||
    props.detail.result != null ||
    Boolean(props.detail.output) ||
    Boolean(props.detail.error);
  return (
    <ToolCard
      title={props.common.label}
      subtitle={props.detail.error ?? props.common.server}
      status={props.common.status}
      muted={props.common.muted}
      trailing={props.common.trailing}
      hasContent={hasContent()}
    >
      <FoldedExchange
        request={props.detail.input}
        response={props.detail.result}
        responseText={props.detail.output}
        error={props.detail.error}
      />
    </ToolCard>
  );
}
