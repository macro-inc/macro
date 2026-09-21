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
      title={props.common.title}
      activeTitle={props.common.activeTitle}
      icon={props.common.icon}
      subtitle={props.detail.command ?? undefined}
      status={props.common.status}
      failed={props.common.failed}
      trailing={props.common.trailing}
      hasContent={Boolean(props.detail.output)}
    >
      <Show when={props.detail.output}>
        {(output) => (
          <FoldedTerminal output={output()} exitCode={props.detail.exitCode} />
        )}
      </Show>
    </ToolCard>
  );
}
