import { t } from '@app/lib/i18n';
import ArrowSquareOut from '@icon/system/regular/arrow-square-out.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import GitBranchIcon from '@icon/system/regular/git-branch.svg';
import { Button, CopyButton, Surface } from '@ui';
import { Show } from 'solid-js';

export function BranchPreview(props: {
  branch: string;
  repository?: string;
  url?: string;
  onCopy: () => Promise<boolean>;
  onOpen: () => void;
}) {
  return (
    <div class="w-80 text-ink">
      <Surface depth={3} hideBorder class="menu-surface rounded-xl">
        <div class="flex items-center gap-2 p-2">
          <GitBranchIcon class="size-4 shrink-0 text-ink-muted" />
          <span class="min-w-0 flex-1 truncate font-mono text-xs">
            {props.branch}
          </span>
          <CopyButton
            variant="ghost"
            size="icon-xs"
            aria-label={t('agentWork.copyBranch')}
            tooltip={t('agentWork.copyBranch')}
            onClick={props.onCopy}
            icon={<CopyIcon class="size-4" />}
          />
          <Show when={props.url}>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('agentWork.openOnGithub')}
              tooltip={t('agentWork.openOnGithub')}
              onClick={props.onOpen}
            >
              <ArrowSquareOut class="size-4" />
            </Button>
          </Show>
        </div>
        <Show when={props.repository}>
          <div class="truncate pb-2.5 pl-8 pr-2 text-xs text-ink-extra-muted">
            {props.repository}
          </div>
        </Show>
      </Surface>
    </div>
  );
}
