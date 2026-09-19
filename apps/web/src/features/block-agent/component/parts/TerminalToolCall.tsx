/**
 * A shell command: `$ cmd` in the row, ANSI-colored output in the body,
 * streaming in while the command runs.
 */

import type { ToolDetail } from '@service-agent-fold/generated/types';
import { Show } from 'solid-js';
import { FoldedTerminal, isToolActive, ToolCard } from '../../ui';
import type { ToolCallCommon } from './shared';

export function TerminalToolCall(props: {
  detail: Extract<ToolDetail, { kind: 'terminal' }>;
  common: ToolCallCommon;
}) {
  return (
    <ToolCard
      title={props.common.label}
      subtitle={props.detail.command ?? undefined}
      status={props.common.status}
      muted={props.common.muted}
      trailing={props.common.trailing}
      hasContent={Boolean(props.detail.output)}
    >
      <Show when={props.detail.output}>
        {(output) => (
          <FoldedTerminal
            output={output()}
            exitCode={props.detail.exitCode}
            active={isToolActive(props.common.status)}
          />
        )}
      </Show>
    </ToolCard>
  );
}
