import { t } from '@app/lib/i18n';
import type { ComputerStatus, ComputerUsage } from '@service-auth/computers';
import { cn, Tooltip } from '@ui';
import type { JSX } from 'solid-js';
import { formatMemoryGb } from '../core/computer-usage';
import { UsageSparkline } from './usage-sparkline';

const BYTES_PER_GIB = 1024 ** 3;

function Metric(props: {
  name: string;
  value: string;
  values: readonly (number | null)[];
  max: number;
  label: string;
  /**
   * Wide enough for the longest value, so every row's lines start together.
   * A narrow row stacks the metrics, each with its line at the right edge.
   */
  class: string;
}): JSX.Element {
  return (
    <span class="flex min-w-0 items-center gap-2 @max-[480px]:w-full @max-[480px]:justify-between">
      <span class={cn('whitespace-nowrap', props.class)}>
        {props.name}{' '}
        <span class="tabular-nums text-ink-muted">{props.value}</span>
      </span>
      <UsageSparkline
        values={props.values}
        max={props.max}
        label={props.label}
      />
    </span>
  );
}

/**
 * A computer's CPU and memory over the last day, under its row's meta line:
 * the latest reading in words and a tiny line each. A computer with no
 * recent reading (put to sleep while idle) keeps its lines and reads idle.
 */
export function ComputerUsageLine(props: {
  computer: ComputerStatus;
  usage: ComputerUsage;
}) {
  const latest = () => props.usage.latest;
  const cpu = () => {
    const now = latest();
    if (!now) return t('computers.usageIdle');
    // A computer's first reading after it starts has no CPU measured yet.
    if (now.cpuPercent == null) return t('computers.usageMeasuring');
    return t('computers.usagePercent', { percent: Math.round(now.cpuPercent) });
  };
  const memory = () => {
    const now = latest();
    return now
      ? t('computers.usageMemory', {
          used: formatMemoryGb(now.memoryBytes),
          total: props.computer.memoryGib,
        })
      : t('computers.usageIdle');
  };
  return (
    <div
      class="mt-1.5 flex flex-wrap items-center gap-x-6 gap-y-1 pl-4 text-xs text-ink-extra-muted"
      data-computer-usage={props.computer.id}
    >
      <Metric
        name={t('computers.usageCpu')}
        value={cpu()}
        values={props.usage.points.map((point) => point?.cpuPercent ?? null)}
        max={100}
        class="@min-[481px]:w-16"
        label={t('computers.usageCpuChart')}
      />
      {/* What the host can measure leaves out memory shared with the image. */}
      <Tooltip
        label={t('computers.usageMemoryHint')}
        placement="bottom"
        class="@max-[480px]:w-full"
      >
        <Metric
          name={t('computers.usageMemoryName')}
          value={memory()}
          values={props.usage.points.map((point) => point?.memoryBytes ?? null)}
          max={props.computer.memoryGib * BYTES_PER_GIB}
          class="@min-[481px]:w-36"
          label={t('computers.usageMemoryChart')}
        />
      </Tooltip>
    </div>
  );
}
