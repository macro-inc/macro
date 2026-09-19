/** File modifications: +/− badge in the row, Pierre-rendered diffs in the body. */

import type { ToolDetail } from '@service-agent-fold/generated/types';
import { Show } from 'solid-js';
import { countDiffChanges } from '../../state/session-summary';
import { DiffChanges, PierreDiff, ToolCard } from '../../ui';
import { pathsSubtitle, type ToolCallCommon } from './shared';

export function EditToolCall(props: {
  detail: Extract<ToolDetail, { kind: 'edit' }>;
  common: ToolCallCommon;
}) {
  const changes = () => countDiffChanges(props.detail.diffs);

  return (
    <ToolCard
      title={props.common.label}
      subtitle={pathsSubtitle(props.detail.diffs.map((diff) => diff.path))}
      trailing={props.common.trailing ?? <DiffChanges {...changes()} />}
      status={props.common.status}
      muted={props.common.muted}
    >
      <Show when={props.detail.diffs.length > 0}>
        <PierreDiff diffs={props.detail.diffs} />
      </Show>
    </ToolCard>
  );
}
