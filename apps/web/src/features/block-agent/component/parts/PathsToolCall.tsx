/** A read, delete, or move: path (or count) in the row, full list in the body. */

import type { ToolDetail } from '@service-agent-fold/generated/types';
import { Show } from 'solid-js';
import { FoldedPathList, ToolCard } from '../../ui';
import { pathsSubtitle, type ToolCallCommon } from './shared';

export function PathsToolCall(props: {
  detail: Extract<ToolDetail, { kind: 'read' | 'delete' | 'move' }>;
  common: ToolCallCommon;
}) {
  return (
    <ToolCard
      title={props.common.label}
      subtitle={pathsSubtitle(props.detail.paths)}
      status={props.common.status}
      muted={props.common.muted}
      trailing={props.common.trailing}
    >
      <Show when={props.detail.paths.length > 1}>
        <FoldedPathList paths={props.detail.paths} />
      </Show>
    </ToolCard>
  );
}
