import { t } from '@app/lib/i18n';
import IconJira from '@icon/import/jira.svg';
import IconNotion from '@icon/import/notion.svg';
import IconLinear from '@icon/mcp-linear.svg';
import IconSlack from '@icon/slack-color.svg';
import ArrowSquareOut from '@icon/system/regular/arrow-square-out.svg';
import TrayArrowDown from '@icon/system/regular/tray-arrow-down.svg';
import X from '@icon/system/regular/x.svg';
import { Popover } from '@kobalte/core/popover';
import type { ImportSource, RunErrorKind } from '@service-cognition/import';
import { Button, cn, Item, ProgressRing } from '@ui';
import { type Component, Index, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import {
  type ImportJob,
  type ImportJobPhase,
  phaseFraction,
} from '../core/import-job';

type SourceDisplay = {
  name: string;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
};

// Product names, not translated.
const SOURCES: Record<ImportSource, SourceDisplay> = {
  notion: { name: 'Notion', icon: IconNotion },
  linear: { name: 'Linear', icon: IconLinear },
  jira: { name: 'Jira', icon: IconJira },
  slack: { name: 'Slack', icon: IconSlack },
};

function phaseLabel(source: ImportSource, phase: ImportJobPhase): string {
  return match(phase)
    .with({ kind: 'scanning' }, ({ found }) =>
      match(source)
        .with('notion', () => t('importJobs.scanningPages', { count: found }))
        .with('linear', 'jira', () =>
          t('importJobs.scanningIssues', { count: found })
        )
        .with('slack', () => t('importJobs.findingChannels'))
        .exhaustive()
    )
    .with({ kind: 'deciding' }, ({ remaining }) =>
      t('importJobs.deciding', { count: remaining })
    )
    .with({ kind: 'awaitingApproval' }, () => t('importJobs.awaitingApproval'))
    .with({ kind: 'choosingChannels' }, () => t('importJobs.choosingChannels'))
    .with({ kind: 'importing' }, ({ done, total }) =>
      t('importJobs.importing', { done, count: total })
    )
    .with({ kind: 'importingChannels' }, ({ channels }) =>
      t('importJobs.importingChannels', { count: channels })
    )
    .with({ kind: 'completed' }, ({ partial }) =>
      partial ? t('importJobs.completedPartly') : t('importJobs.completed')
    )
    .with({ kind: 'failed' }, ({ errorKind }) => failedLabel(source, errorKind))
    .with({ kind: 'cancelled' }, () => t('importJobs.cancelled'))
    .exhaustive();
}

/** Why a run failed, from its kind; never the server's raw error. */
function failedLabel(
  source: ImportSource,
  errorKind: RunErrorKind | null
): string {
  const name = SOURCES[source].name;
  return match(errorKind)
    .with('access_lost', () =>
      t('importJobs.failedAccessLost', { source: name })
    )
    .with('connection_unavailable', () =>
      t('importJobs.failedConnectionUnavailable', { source: name })
    )
    .with('not_connected', () =>
      t('importJobs.failedNotConnected', { source: name })
    )
    .with('not_found', () => t('importJobs.failedNotFound', { source: name }))
    .with('forbidden', () => t('importJobs.failedForbidden', { source: name }))
    .with('rate_limited', () =>
      t('importJobs.failedRateLimited', { source: name })
    )
    .with('unreachable', () =>
      t('importJobs.failedUnreachable', { source: name })
    )
    .with('usage_refused', () => t('importJobs.failedUsageRefused'))
    .with('interrupted', () => t('importJobs.failedInterrupted'))
    .with('internal', null, () => t('importJobs.failed'))
    .exhaustive();
}

/** Done over total across the jobs whose progress is measured. */
function overallFraction(jobs: readonly ImportJob[]): number | null {
  const moving = jobs.filter((job) => !job.dismissable);
  const fractions = moving.map((job) => phaseFraction(job.phase));
  if (moving.length === 0) return 1;
  if (fractions.some((fraction) => fraction === null)) return null;

  const sum = fractions.reduce<number>(
    (total, fraction) => total + (fraction ?? 0),
    0
  );
  return sum / fractions.length;
}

/** What a failed job offers: reconnecting a lost connection, or its review. */
function failedAction(job: ImportJob): 'reconnect' | 'details' | null {
  if (job.phase.kind !== 'failed') return null;
  const lost =
    job.phase.errorKind === 'access_lost' ||
    job.phase.errorKind === 'connection_unavailable';
  if (lost && job.source !== 'slack') return 'reconnect';
  return job.sessionId ? 'details' : null;
}

function ImportJobRow(props: {
  job: ImportJob;
  onOpen: (job: ImportJob) => void;
  onDismiss: (job: ImportJob) => void;
  onReconnect: (job: ImportJob) => void;
}) {
  const source = () => SOURCES[props.job.source];
  const label = () => phaseLabel(props.job.source, props.job.phase);
  const percent = () => {
    const fraction = phaseFraction(props.job.phase);
    return fraction === null ? undefined : Math.round(fraction * 100);
  };

  return (
    <Item size="sm" role="listitem" aria-label={source().name}>
      <Item.Icon aria-hidden="true">
        <Dynamic component={source().icon} />
      </Item.Icon>
      <Item.Content>
        <Item.Title>{source().name}</Item.Title>
        <Item.Description>{label()}</Item.Description>
      </Item.Content>
      <Item.Actions>
        <Show when={!props.job.dismissable}>
          <span
            role="progressbar"
            aria-label={label()}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent()}
            class="flex items-center gap-1.5 text-xs tabular-nums text-ink-muted"
          >
            <ProgressRing fraction={phaseFraction(props.job.phase)} />
            <Show when={percent() !== undefined}>{percent()}%</Show>
          </span>
        </Show>
        <Show when={failedAction(props.job) === 'reconnect'}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => props.onReconnect(props.job)}
          >
            {t('importJobs.reconnect', { source: source().name })}
          </Button>
        </Show>
        <Show when={failedAction(props.job) === 'details'}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => props.onOpen(props.job)}
          >
            {t('importJobs.viewDetails')}
          </Button>
        </Show>
        <Show when={props.job.sessionId && props.job.phase.kind !== 'failed'}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('importJobs.openImport', {
              source: source().name,
            })}
            tooltip={t('importJobs.openImport', { source: source().name })}
            onClick={() => props.onOpen(props.job)}
          >
            <ArrowSquareOut class="size-4 shrink-0" />
          </Button>
        </Show>
        <Show when={props.job.dismissable}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('importJobs.dismissImport', {
              source: source().name,
            })}
            tooltip={t('importJobs.dismissImport', { source: source().name })}
            onClick={() => props.onDismiss(props.job)}
          >
            <X class="size-4 shrink-0" />
          </Button>
        </Show>
      </Item.Actions>
    </Item>
  );
}

/**
 * Background imports as a rail button beside Help and Settings, opening
 * into one row per job, so nothing floats over the page. The button shows a
 * ring while a job moves and a dot when one failed.
 */
export function ImportJobsRailButton(props: {
  jobs: readonly ImportJob[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpen: (job: ImportJob) => void;
  onDismiss: (job: ImportJob) => void;
  onReconnect: (job: ImportJob) => void;
}) {
  const moving = () => props.jobs.some((job) => !job.dismissable);
  const failed = () => props.jobs.some((job) => job.phase.kind === 'failed');
  const label = () => t('importJobs.summary', { count: props.jobs.length });
  return (
    <Show when={props.jobs.length > 0}>
      <Popover
        open={props.open}
        onOpenChange={props.onOpenChange}
        placement="right-end"
        gutter={8}
      >
        <Popover.Trigger
          as={Button}
          variant="ghost"
          size="icon-md"
          class={cn(
            'size-10 cursor-default rounded-xl',
            props.open && 'bg-hover text-ink'
          )}
          aria-label={label()}
          aria-description={
            failed() ? t('importJobs.somethingFailed') : undefined
          }
          tooltip={{ content: label(), placement: 'right' }}
          draggable={false}
          data-sidebar-next-item="imports"
        >
          <span class="pointer-events-none relative flex size-6 items-center justify-center">
            <Show
              when={moving()}
              fallback={<TrayArrowDown class="size-5" aria-hidden="true" />}
            >
              <ProgressRing size="md" fraction={overallFraction(props.jobs)} />
            </Show>
            <Show when={failed()}>
              <span
                aria-hidden="true"
                data-testid="imports-failed-dot"
                class="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-failure"
              />
            </Show>
          </span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            aria-label={t('importJobs.trayLabel')}
            class="menu-surface z-modal w-[340px] max-w-[calc(100vw-5rem)] p-1 outline-none animate-menu-open"
          >
            <div role="list">
              <Index each={props.jobs}>
                {(job) => (
                  <ImportJobRow
                    job={job()}
                    onOpen={props.onOpen}
                    onDismiss={props.onDismiss}
                    onReconnect={props.onReconnect}
                  />
                )}
              </Index>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover>
    </Show>
  );
}
