import { useChanges } from '@app/features/changes/changes';
import { t } from '@app/lib/i18n';
import { useFlow } from '@app/observability/flow';
import Copy from '@icon/system/regular/copy.svg';
import * as Popover from '@kobalte/core/popover';
import { CopyButton } from '@ui';
import { For } from 'solid-js';
import type { PrPageReadModel } from '../../context/pr-page-read-model';
import { PrBranchPill } from './pr-header';

export function PrBranchNames(props: { page: PrPageReadModel }) {
  const { context } = useChanges();
  const flow = useFlow();
  const copyBranch = async (name: string) => {
    const copied = await flow.task('pr.copy-branch', () =>
      context.host.copyText(name)
    );
    if (!copied) context.host.notify(t('prPage.copyFailed'), 'failure');
    return copied;
  };
  const branches = () =>
    [
      { label: t('prPage.headBranch'), name: props.page.headBranch },
      { label: t('prPage.baseBranch'), name: props.page.baseBranch },
    ].filter((branch) => branch.name);
  return (
    <div class="flex flex-col gap-3 p-3">
      <For each={branches()}>
        {(branch) => (
          <div class="flex min-w-0 items-center gap-3">
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <span class="text-xs text-ink-muted">{branch.label}</span>
              <span class="break-all font-mono text-sm">{branch.name}</span>
            </div>
            <CopyButton
              variant="ghost"
              size="icon-sm"
              aria-label={t('prPage.copyBranch')}
              icon={<Copy class="size-4" />}
              onClick={() => copyBranch(branch.name ?? '')}
            />
          </div>
        )}
      </For>
    </div>
  );
}

export function PrBranchPopover(props: { page: PrPageReadModel }) {
  return (
    <Popover.Root placement="bottom-start">
      <Popover.Trigger
        as={PrBranchPill}
        page={props.page}
        trailing={<Copy class="size-3.5 shrink-0" />}
      />
      <Popover.Portal>
        <Popover.Content
          class="menu-surface z-modal min-w-64 max-w-[min(480px,90vw)] rounded-xl"
          aria-label={t('prPage.branch')}
        >
          <PrBranchNames page={props.page} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
