/**
 * The card for fetch and think: label in the row, whatever text the call
 * reported in the body — the chat block's GenericTool analog.
 */

import type { ToolDetail } from '@service-agent-fold/generated/types';
import { Show } from 'solid-js';
import { FoldedOutput, ToolCard } from '../../ui';
import type { ToolCallCommon } from './shared';

export function OutputToolCall(props: {
  detail: Extract<ToolDetail, { kind: 'fetch' | 'think' }>;
  common: ToolCallCommon;
}) {
  return (
    <ToolCard
      title={props.common.title}
      activeTitle={props.common.activeTitle}
      icon={props.common.icon}
      status={props.common.status}
      failed={props.common.failed}
      trailing={props.common.trailing}
      hasContent={Boolean(props.detail.output)}
    >
      <Show when={props.detail.output}>
        {(output) => <FoldedOutput text={output()} />}
      </Show>
    </ToolCard>
  );
}
