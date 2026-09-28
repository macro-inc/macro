/** A shell command: `$ cmd` in the row, ANSI-colored output in the body. */

import TerminalIcon from '@phosphor/terminal.svg';
import type { ToolDetail } from '@service-agent-fold/generated/types';
import { Show } from 'solid-js';
import { FoldedTerminal, ToolCard } from '../../ui';
import type { ToolCallCommon } from './shared';

export function TerminalToolCall(props: {
  detail: Extract<ToolDetail, { kind: 'terminal' }>;
  common: ToolCallCommon;
}) {
  const failed = () =>
    props.detail.exitCode != null && props.detail.exitCode !== 0;
  return (
    <ToolCard
      icon={<TerminalIcon class="size-4" />}
      title={props.common.label}
      subtitle={props.detail.command ?? undefined}
      status={props.common.status}
      muted={props.common.muted || failed()}
      trailing={
        props.common.trailing ??
        (failed() ? `Failed · exit ${props.detail.exitCode}` : undefined)
      }
      hasContent={props.detail.output != null || props.detail.exitCode != null}
    >
      <Show when={props.detail.output != null || props.detail.exitCode != null}>
        <FoldedTerminal
          output={props.detail.output ?? ''}
          exitCode={props.detail.exitCode}
        />
      </Show>
    </ToolCard>
  );
}
