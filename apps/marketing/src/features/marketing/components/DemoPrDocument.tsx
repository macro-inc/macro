import GitMerge from '@phosphor/git-merge.svg';
import GitPullRequest from '@phosphor/git-pull-request.svg';
import { cn, Layer } from '@ui';
import { type JSX, Show } from 'solid-js';
import { DEPLOY_PR } from '../core/deploy-agent-demo';
import { DemoMarkdown } from './DemoMarkdown';

export function PrStatusIcon(props: { status: string; class?: string }) {
  return (
    <Show
      when={props.status === 'merged'}
      fallback={
        <GitPullRequest class={cn('size-3.5 text-success', props.class)} />
      }
    >
      <GitMerge class={cn('size-3.5 text-note', props.class)} />
    </Show>
  );
}

function PrPill(props: { class?: string; children: JSX.Element }) {
  return (
    <Layer depth={2}>
      <span
        class={cn(
          'inline-flex items-center gap-1.5 min-w-0 border border-edge-muted px-2 py-1 leading-tight text-left rounded-full bg-surface',
          props.class
        )}
      >
        {props.children}
      </span>
    </Layer>
  );
}

/** Frozen PR presentation using fictional content; no GitHub/service dependencies. */
export function DemoPrDocument(props: {
  merged?: boolean;
  record?: {
    name: string;
    description: string;
    repository: string;
    number: number;
  };
}) {
  const record = () => props.record ?? DEPLOY_PR;
  return (
    <>
      <h1 class="text-2xl font-semibold">{record().name}</h1>
      <div class="spacer h-3" />
      <div class="mb-6 flex flex-row flex-wrap items-center gap-2 text-sm">
        <PrPill
          class={props.merged ? 'shrink-0 text-note' : 'shrink-0 text-success'}
        >
          <PrStatusIcon
            status={props.merged ? 'merged' : 'open'}
            class="size-3 shrink-0"
          />
          {props.merged ? 'Merged' : 'Open'}
        </PrPill>
        <PrPill class="text-ink-muted">
          {props.record
            ? `${props.record.repository}#${props.record.number}`
            : 'macro-inc/macro#482'}
        </PrPill>
        <Show when={!props.record}>
          <PrPill>
            <span class="text-success">+{DEPLOY_PR.additions}</span>
            <span class="text-failure">−{DEPLOY_PR.deletions}</span>
          </PrPill>
        </Show>
      </div>
      <div class="text-sm wrap-break-word max-w-full overflow-x-auto">
        <DemoMarkdown markdown={record().description} />
      </div>
    </>
  );
}
