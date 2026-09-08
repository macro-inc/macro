import ToolIcon from '@phosphor/terminal.svg';
/** A shell command: `$ cmd` in the row, ANSI-colored output in the body. */

import type { ToolDetail } from '@service-agent-fold/generated/types';
import { Show } from 'solid-js';
import { FoldedTerminal, ToolCard } from '../../ui';
import type { ToolCallCommon } from './shared';

export function TerminalToolCall(props: {
  detail: Extract<ToolDetail, { kind: 'terminal' }>;
  common: ToolCallCommon;
}) {
  return (
    <ToolCard
      icon={<ToolIcon class="size-4" />}
      title={props.common.label}
      subtitle={props.detail.command ?? undefined}
      status={props.common.status}
      muted={props.common.muted}
      trailing={props.common.trailing}
    >
      <Show when={props.detail.output}>
        {(output) => (
          <div class="p-3">
            <FoldedTerminal
              output={output()}
              exitCode={props.detail.exitCode}
            />
          </div>
        )}
      </Show>
    </ToolCard>
  );
}
