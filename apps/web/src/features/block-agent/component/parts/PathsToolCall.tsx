/** A read, delete, or move: path (or count) in the row, full list in the body. */

import MoveIcon from '@phosphor/arrows-left-right.svg';
import ReadIcon from '@phosphor/file-text.svg';
import TrashIcon from '@phosphor/trash.svg';
import type { ToolDetail } from '@service-agent-fold/generated/types';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import { displayPaths } from '../../core/display-path';
import { FoldedPathList, ToolCard } from '../../ui';
import { pathsSubtitle, type ToolCallCommon } from './shared';

export function PathsToolCall(props: {
  detail: Extract<ToolDetail, { kind: 'read' | 'delete' | 'move' }>;
  common: ToolCallCommon;
}) {
  const paths = () => displayPaths(props.detail.paths, props.common.workspace);
  return (
    <ToolCard
      icon={match(props.detail.kind)
        .with('read', () => <ReadIcon class="size-4" />)
        .with('delete', () => <TrashIcon class="size-4" />)
        .with('move', () => <MoveIcon class="size-4" />)
        .exhaustive()}
      title={props.common.label}
      subtitle={pathsSubtitle(paths(), props.common.workspace)}
      status={props.common.status}
      muted={props.common.muted}
      trailing={
        props.common.trailing ??
        (props.common.status === 'completed' && paths().length > 0
          ? `${paths().length} ${paths().length === 1 ? 'file' : 'files'}`
          : undefined)
      }
      hasContent={paths().length > 0}
    >
      <Show when={paths().length > 0}>
        <FoldedPathList paths={paths()} />
      </Show>
    </ToolCard>
  );
}
