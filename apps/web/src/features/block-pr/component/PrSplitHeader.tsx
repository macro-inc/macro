import {
  type FileOperation,
  SplitFileMenu,
} from '@components/app/split-layout/components/SplitFileMenu';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import {
  SplitTitleFileMenu,
  StaticSplitLabel,
} from '@components/app/split-layout/components/SplitLabel';
import { Permissions } from '@core/component/SharePermissions';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { openExternalUrl } from '@core/util/url';
import GithubIcon from '@icon/mcp-github.svg';
import GitMerge from '@phosphor/git-merge.svg';
import GitPullRequest from '@phosphor/git-pull-request.svg';
import type { GithubPullRequest } from '@service-storage/generated/schemas';
import { cn, Layer } from '@ui';
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
  'inline-flex items-center gap-1.5 min-w-0 border border-edge-muted px-2 py-1 leading-tight text-left rounded-full bg-surface';

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
 * PR identity in the split header chrome and file menu, independent of the
 * legacy block context. Foreign PRs have the same read-only permission that
 * the legacy BlockLoader supplied by default.
 */
export function PrSplitHeader(props: {
  foreignEntityId: string;
  prRef: PrRef;
  enrichment: GithubPullRequest | undefined;
}) {
  const title = () => props.enrichment?.name ?? prDisplayName(props.prRef);
  const githubUrl = () => props.enrichment?.url ?? prHtmlUrl(props.prRef);

  const ops: FileOperation[] = [
    {
      label: 'Open on GitHub',
      icon: GithubIcon,
      action: () => openExternalUrl(githubUrl()),
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

      <SplitTitleFileMenu>
        <SplitFileMenu
          id={props.foreignEntityId}
          itemType="foreign"
          entityKind="pr"
          permissions={Permissions.CAN_VIEW}
          name={title()}
          ops={ops}
          buttonClass={isTouchDevice() ? 'order-last' : 'order-first'}
        />
      </SplitTitleFileMenu>
    </>
  );
}
