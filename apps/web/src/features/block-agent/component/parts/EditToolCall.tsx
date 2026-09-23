/** File modifications: +/− badge in the row, Pierre-rendered diffs in the body. */

import PencilIcon from '@phosphor/pencil-simple.svg';
import type { ToolDetail } from '@service-agent-fold/generated/types';
import { createMemo, Show } from 'solid-js';
import { displayPath } from '../../core/display-path';
import { countDiffChanges } from '../../state/session-summary';
import { DiffChanges, PierreDiff, ToolCard } from '../../ui';
import { pathsSubtitle, type ToolCallCommon } from './shared';

export function EditToolCall(props: {
  detail: Extract<ToolDetail, { kind: 'edit' }>;
  common: ToolCallCommon;
}) {
  const changes = createMemo(() => countDiffChanges(props.detail.diffs));
  const hasChanges = () => changes().additions + changes().deletions > 0;
  const diffs = () =>
    props.detail.diffs.map((diff) => ({
      ...diff,
      path: displayPath(diff.path, props.common.workspace),
    }));

  return (
    <ToolCard
      icon={<PencilIcon class="size-4" />}
      title={props.common.label}
      subtitle={pathsSubtitle(
        diffs().map((diff) => diff.path),
        props.common.workspace
      )}
      trailing={
        props.common.trailing ??
        (props.common.status === 'completed' && hasChanges() ? (
          <DiffChanges {...changes()} />
        ) : undefined)
      }
      status={props.common.status}
      muted={props.common.muted}
      hasContent={props.detail.diffs.length > 0}
    >
      <Show when={diffs().length > 0}>
        <PierreDiff diffs={diffs()} />
      </Show>
    </ToolCard>
  );
}
