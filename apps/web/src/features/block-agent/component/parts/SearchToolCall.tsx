import ToolIcon from '@phosphor/magnifying-glass.svg';
/** A search: scope in the row, reported hits in the body. */

import type { ToolDetail } from '@service-agent-fold/generated/types';
import { Show } from 'solid-js';
import { FoldedOutput, ToolCard } from '../../ui';
import { pathsSubtitle, type ToolCallCommon } from './shared';

export function SearchToolCall(props: {
  detail: Extract<ToolDetail, { kind: 'search' }>;
  common: ToolCallCommon;
}) {
  return (
    <ToolCard
      icon={<ToolIcon class="size-4" />}
      title={props.common.label}
      subtitle={pathsSubtitle(props.detail.paths)}
      status={props.common.status}
      muted={props.common.muted}
      trailing={props.common.trailing}
    >
      <Show when={props.detail.output}>
        {(output) => (
          <div class="p-3">
            <FoldedOutput label="Search results" text={output()} />
          </div>
        )}
      </Show>
    </ToolCard>
  );
}
