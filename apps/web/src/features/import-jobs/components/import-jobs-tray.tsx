import { t } from '@app/lib/i18n';
import IconJira from '@icon/import/jira.svg';
import IconNotion from '@icon/import/notion.svg';
import IconLinear from '@icon/mcp-linear.svg';
import IconSlack from '@icon/slack-color.svg';
import ArrowSquareOut from '@icon/system/regular/arrow-square-out.svg';
import CaretUp from '@icon/system/regular/caret-up.svg';
import X from '@icon/system/regular/x.svg';
import type { ImportSource } from '@service-cognition/import';
import { Button, cn, Item, ProgressRing, Surface } from '@ui';
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
    .with({ kind: 'completed' }, () => t('importJobs.completed'))
    .with({ kind: 'failed' }, () => t('importJobs.failed'))
    .with({ kind: 'cancelled' }, () => t('importJobs.cancelled'))
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

function ImportJobRow(props: {
  job: ImportJob;
  onOpen: (job: ImportJob) => void;
  onDismiss: (job: ImportJob) => void;
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
        <Show when={props.job.sessionId}>
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
 * Background imports as a pill in the corner that opens into one row per
 * job. Moving jobs show their progress; settled ones can be dismissed.
 */
export function ImportJobsTray(props: {
  jobs: readonly ImportJob[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onOpen: (job: ImportJob) => void;
  onDismiss: (job: ImportJob) => void;
}) {
  return (
    <Show when={props.jobs.length > 0}>
      <section
        aria-label={t('importJobs.trayLabel')}
        class="pointer-events-auto flex flex-col items-end gap-2"
      >
        <Show when={props.expanded}>
          <Surface
            hideBorder
            role="list"
            class="flex w-full flex-col rounded-2xl glass bg-toast p-1"
          >
            <Index each={props.jobs}>
              {(job) => (
                <ImportJobRow
                  job={job()}
                  onOpen={props.onOpen}
                  onDismiss={props.onDismiss}
                />
              )}
            </Index>
          </Surface>
        </Show>
        <Surface
          hideBorder
          class="flex size-auto items-center rounded-full glass bg-toast p-0.5"
        >
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={props.expanded}
            aria-label={
              props.expanded
                ? t('importJobs.hideImports')
                : t('importJobs.showImports')
            }
            onClick={() => props.onExpandedChange(!props.expanded)}
          >
            <ProgressRing fraction={overallFraction(props.jobs)} />
            <span>{t('importJobs.summary', { count: props.jobs.length })}</span>
            <CaretUp
              class={cn(
                'size-4 shrink-0 motion-safe:transition-transform',
                props.expanded && 'rotate-180'
              )}
            />
          </Button>
        </Surface>
      </section>
    </Show>
  );
}
