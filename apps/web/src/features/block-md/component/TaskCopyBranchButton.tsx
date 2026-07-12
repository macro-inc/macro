import { useBlockId } from '@core/block';
import { TOKENS } from '@core/hotkey/tokens';
import { copyBranchNameToClipboard } from '@core/util/branchName';
import GitBranch from '@phosphor/git-branch.svg';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';

export function TaskCopyBranchButton(props: {
  showLabel?: boolean;
  class?: string;
}) {
  const blockId = useBlockId();
  const showLabel = () => props.showLabel ?? true;

  return (
    <Button
      variant="ghost"
      size="sm"
      depth={2}
      tooltip={showLabel() ? undefined : 'Copy branch name'}
      hotkey={TOKENS.entity.action.copyBranchName}
      class={cn('gap-1.5 rounded-full px-2 ring ring-edge-muted', props.class)}
      onClick={() => void copyBranchNameToClipboard(blockId)}
    >
      <GitBranch class="size-3.5" />
      <Show when={showLabel()}>
        <span class="text-xs font-medium">Copy branch name</span>
      </Show>
    </Button>
  );
}
