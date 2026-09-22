/**
 * A summary-only row for calls without a registered result renderer.
 * The MCP server stays beside the tool name; raw arguments and results are
 * never exposed as a fallback disclosure.
 */

import type { ToolDetail } from '@service-agent-fold/generated/types';
import type { JSX } from 'solid-js';
import { ToolCard } from '../../ui';
import type { ToolCallCommon } from './shared';

type ExchangeDetail = Extract<ToolDetail, { kind: 'other' }>;

export function ExchangeToolCall(props: {
  detail: ExchangeDetail;
  common: ToolCallCommon;
}): JSX.Element {
  return (
    <ToolCard
      title={props.common.label}
      subtitle={props.common.server}
      status={props.common.status}
      muted={props.common.muted || props.detail.error != null}
      trailing={
        props.common.trailing ??
        (props.detail.error != null ? 'Failed' : undefined)
      }
    />
  );
}
