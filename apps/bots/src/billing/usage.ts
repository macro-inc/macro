import type { StartedHourUsage } from './read';

const fullDate = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeZone: 'UTC',
});
const shortDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export function formatDate(date: string) {
  return fullDate.format(new Date(date));
}

export function dateRange(start: string, end: string) {
  return `${shortDate.format(new Date(start))} – ${formatDate(end)} · UTC`;
}

export function money(
  amountMinor: number,
  currency: string,
  showFraction = false
) {
  const format = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  });
  const { maximumFractionDigits } = format.resolvedOptions();
  const amount = amountMinor / 10 ** (maximumFractionDigits ?? 2);

  if (!showFraction && Number.isInteger(amount)) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
    }).format(amount);
  }

  return format.format(amount);
}

export function summarizeUsage(usage: StartedHourUsage) {
  const date = new Date(usage.cycle.start);
  const through = new Date(usage.observedThrough);
  const end = new Date(usage.cycle.end);
  const dayCount = (through.getTime() - date.getTime()) / 86_400_000 + 1;

  if (
    !Number.isInteger(dayCount) ||
    dayCount <= 0 ||
    !(through <= end) ||
    usage.agents.length === 0
  ) {
    return;
  }

  for (const agent of usage.agents) {
    if (agent.startedHoursByDay.length !== dayCount) return;

    for (const hours of agent.startedHoursByDay) {
      if (!Number.isSafeInteger(hours) || hours < 0) return;
    }
  }

  const days = [];

  for (let day = 0; date <= through; day += 1) {
    days.push({
      label: shortDate.format(date),
      hours: usage.agents.reduce(
        (total, agent) => total + agent.startedHoursByDay[day],
        0
      ),
    });
    date.setUTCDate(date.getUTCDate() + 1);
  }

  const agents = usage.agents.map((agent) => {
    const hours = agent.startedHoursByDay.reduce(
      (total, day) => total + day,
      0
    );
    return {
      name: agent.name,
      hours,
      rateMinor: agent.rateMinor,
      estimateMinor: hours * agent.rateMinor,
    };
  });

  return {
    agents,
    days,
    peak: Math.max(0, ...days.map((day) => day.hours)),
    hours: days.reduce((total, day) => total + day.hours, 0),
    estimateMinor: agents.reduce(
      (total, agent) => total + agent.estimateMinor,
      0
    ),
  };
}
