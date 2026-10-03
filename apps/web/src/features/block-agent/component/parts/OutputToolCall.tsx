/**
 * The card for fetch and think: label in the row, whatever text the call
 * reported in the body — the chat block's GenericTool analog.
 */

import BrainIcon from '@phosphor/brain.svg';
import GlobeIcon from '@phosphor/globe.svg';
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
      icon={
        props.detail.kind === 'fetch' ? (
          <GlobeIcon class="size-4" />
        ) : (
          <BrainIcon class="size-4" />
        )
      }
      title={props.common.label}
      status={props.common.status}
      muted={props.common.muted}
      trailing={props.common.trailing}
      hasContent={Boolean(props.detail.output)}
    >
      <Show when={props.detail.output}>
        {(output) => <FoldedOutput text={output()} />}
      </Show>
    </ToolCard>
  );
}
