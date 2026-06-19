import {
  type BlockTool,
  ResponsiveBlockToolbar,
} from '@app/component/ResponsiveBlockToolbar';
import { SidePanel, useSidePanel } from '@app/component/side-panel';
import type { FileOperation } from '@app/component/split-layout/components/SplitFileMenu';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@app/component/split-layout/components/SplitLabel';
import { SplitToolbarLeft } from '@app/component/split-layout/components/SplitToolbar';
import { useBlockId } from '@core/block';
import { toast } from '@core/component/Toast/Toast';
import { TOKENS } from '@core/hotkey/tokens';
import { buildSimpleEntityUrl, openExternalUrl } from '@core/util/url';
import GithubIcon from '@icon/mcp-github.svg';
import GitMerge from '@phosphor/git-merge.svg';
import GitPullRequest from '@phosphor/git-pull-request.svg';
import LinkIcon from '@phosphor/link.svg';
import SidePanelIcon from '@phosphor/square-half.svg';
import type { GithubPullRequest } from '@service-storage/generated/schemas';
import { Button, cn, Layer } from '@ui';
import { Show } from 'solid-js';

import type { PrRef } from '../util/prKey';
import { prDisplayName, prHtmlUrl } from '../util/prKey';

// Status icon colors follow the soup PR rows (entity-icon.tsx):
// open → green pull-request icon, merged → purple merge icon, closed → red.
const STATUS_ICON_CLASS: Record<string, string> = {
  open: 'text-success',
  merged: 'text-note',
  closed: 'text-failure',
};

const STATUS_TEXT_CLASS: Record<string, string> = {
  open: 'text-success',
  merged: 'text-note',
  closed: 'text-failure',
};

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Pill surface matching the task block's inline property pills. */
export const PR_PILL_CLASS =
  'inline-flex items-center gap-1.5 min-w-0 ring ring-edge-muted px-2 py-1 leading-tight text-left rounded-full bg-surface';

export function PrStatusIcon(props: { status: string; class?: string }) {
  return (
    <Show
      when={props.status === 'merged'}
      fallback={
        <GitPullRequest
          class={cn('size-3.5', STATUS_ICON_CLASS[props.status], props.class)}
        />
      }
    >
      <GitMerge class={cn('size-3.5 text-note', props.class)} />
    </Show>
  );
}

/** Status pill matching the task block's inline property pills. */
export function PrStatusChip(props: { status: string; class?: string }) {
  return (
    <Layer depth={2}>
      <span
        class={cn(
          PR_PILL_CLASS,
          'shrink-0',
          STATUS_TEXT_CLASS[props.status],
          props.class
        )}
      >
        <PrStatusIcon status={props.status} class="size-3 shrink-0" />
        {capitalize(props.status)}
      </span>
    </Layer>
  );
}

/**
 * PR identity in the split header chrome plus the standard split toolbar:
 * file menu (open on GitHub), side panel toggle, and narrow content/info
 * tabs — matching the other block types.
 */
export function PrSplitHeader(props: {
  prRef: PrRef;
  enrichment: GithubPullRequest | undefined;
}) {
  const blockId = useBlockId();
  const sidePanel = useSidePanel();
  const title = () => props.enrichment?.name ?? prDisplayName(props.prRef);
  const githubUrl = () => props.enrichment?.url ?? prHtmlUrl(props.prRef);

  const copyLink = async () => {
    await navigator.clipboard.writeText(
      buildSimpleEntityUrl({ type: 'pr', id: blockId })
    );
    toast.success('Link copied to clipboard');
  };

  const ops: FileOperation[] = [
    {
      label: 'Open on GitHub',
      icon: GithubIcon,
      action: () => openExternalUrl(githubUrl()),
    },
  ];

  const tools: BlockTool[] = [
    {
      label: 'Copy link',
      icon: LinkIcon,
      action: copyLink,
    },
    {
      label: () =>
        sidePanel?.isOpen() ? 'Hide Side Panel' : 'Show Side Panel',
      icon: SidePanelIcon,
      action: () => sidePanel?.toggle(),
      isActive: () => sidePanel?.isOpen() ?? false,
      condition: () => !(sidePanel?.isNarrow() ?? false),
      buttonComponent: () => (
        <Show when={sidePanel}>
          {(panel) => (
            <Button
              depth={2}
              variant="base"
              size="icon-sm"
              class={cn('bg-surface order-20', {
                'bg-active': sidePanel?.isOpen(),
              })}
              tooltip={
                sidePanel?.isOpen() ? 'Hide Side Panel' : 'Show Side Panel'
              }
              hotkey={TOKENS.block.toggleSidePanel}
              onClick={() => {
                panel().toggle();
              }}
            >
              <SidePanelIcon />
            </Button>
          )}
        </Show>
      ),
    },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel
          label={title()}
          icon={
            <PrStatusIcon
              status={props.enrichment?.status ?? 'open'}
              class="size-3.5"
            />
          }
        />
      </SplitHeaderLeft>

      <ResponsiveBlockToolbar
        tools={tools}
        ops={ops}
        id={blockId}
        itemType="foreign"
        name={title()}
      />

      <SplitToolbarLeft>
        <SidePanel.NarrowTabs />
      </SplitToolbarLeft>
    </>
  );
}
