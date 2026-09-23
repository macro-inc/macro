/** A read, delete, or move: path (or count) in the row, full list in the body. */

import MoveIcon from '@phosphor/arrows-left-right.svg';
import ReadIcon from '@phosphor/file-text.svg';
import TrashIcon from '@phosphor/trash.svg';
import type { ToolDetail } from '@service-agent-fold/generated/types';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import { FoldedPathList, ToolCard } from '../../ui';
import { pathsSubtitle, type ToolCallCommon } from './shared';

export function PathsToolCall(props: {
  detail: Extract<ToolDetail, { kind: 'read' | 'delete' | 'move' }>;
  common: ToolCallCommon;
}) {
  return (
    <ToolCard
      icon={match(props.detail.kind)
        .with('read', () => <ReadIcon class="size-4" />)
        .with('delete', () => <TrashIcon class="size-4" />)
        .with('move', () => <MoveIcon class="size-4" />)
        .exhaustive()}
      title={props.common.label}
      subtitle={pathsSubtitle(props.detail.paths)}
      status={props.common.status}
      muted={props.common.muted}
      trailing={
        props.common.trailing ??
        (props.common.status === 'completed' && props.detail.paths.length > 0
          ? `${props.detail.paths.length} ${props.detail.paths.length === 1 ? 'file' : 'files'}`
          : undefined)
      }
      hasContent={props.detail.paths.length > 0}
    >
      <Show when={props.detail.paths.length > 0}>
        <FoldedPathList paths={props.detail.paths} />
      </Show>
    </ToolCard>
  );
}
