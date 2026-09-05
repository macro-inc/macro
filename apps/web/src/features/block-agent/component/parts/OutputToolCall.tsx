/**
 * The fallback card for fetch, think, and unmodeled tool kinds: label in the
 * row, whatever text the call reported in the body — the chat block's
 * GenericTool analog.
 */

import type { ToolDetail } from '@service-agent-fold/generated/types';
import { Show } from 'solid-js';
import { FoldedOutput, ToolCard } from '../../ui';
import type { ToolCallCommon } from './shared';

export function OutputToolCall(props: {
  detail: Extract<ToolDetail, { kind: 'fetch' | 'think' | 'other' }>;
  common: ToolCallCommon;
}) {
  return (
    <ToolCard
      title={props.common.label}
      status={props.common.status}
      muted={props.common.muted}
      trailing={props.common.trailing}
    >
      <Show when={props.detail.output}>
        {(output) => <FoldedOutput text={output()} />}
      </Show>
    </ToolCard>
  );
}
