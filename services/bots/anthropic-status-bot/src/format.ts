import type { ComponentWebhook, IncidentWebhook } from './statuspage';

const INCIDENT_STATUS_EMOJI: Record<string, string> = {
  investigating: '🔴',
  identified: '🔴',
  monitoring: '🟡',
  resolved: '✅',
  postmortem: '📝',
  scheduled: '🗓️',
  in_progress: '🛠️',
  verifying: '🛠️',
  completed: '✅',
  canceled: '❌',
};

function humanize(status: string): string {
  return status.replace(/_/g, ' ');
}

/** Statuspage returns incident_updates newest-first, but sort defensively. */
function latestUpdate(incident: IncidentWebhook['incident']) {
  return incident.incident_updates.reduce<
    IncidentWebhook['incident']['incident_updates'][number] | undefined
  >((latest, update) => {
    if (!latest) return update;
    return Date.parse(update.created_at) > Date.parse(latest.created_at)
      ? update
      : latest;
  }, undefined);
}

export function formatIncidentMessage(payload: IncidentWebhook): string {
  const { incident, page } = payload;
  const emoji = INCIDENT_STATUS_EMOJI[incident.status] ?? '⚠️';
  const lines = [`${emoji} [Anthropic Status] ${incident.name}`];

  let statusLine = `Status: ${humanize(incident.status)}`;
  if (incident.impact) {
    statusLine += ` · Impact: ${humanize(incident.impact)}`;
  }
  lines.push(statusLine);

  const latest = latestUpdate(incident);
  if (latest?.body) {
    lines.push(`Latest update: ${latest.body}`);
  }

  if (page.status_description) {
    lines.push(`Page status: ${page.status_description}`);
  }

  if (incident.shortlink) {
    lines.push(incident.shortlink);
  }

  return lines.join('\n');
}

export function formatComponentMessage(payload: ComponentWebhook): string {
  const { component_update, component, page } = payload;
  const emoji =
    component_update.new_status === 'operational'
      ? '✅'
      : component_update.new_status === 'major_outage'
        ? '🔴'
        : '⚠️';

  return [
    `${emoji} [Anthropic Status] Component "${component.name}": ${humanize(component_update.old_status)} → ${humanize(component_update.new_status)}`,
    `Page status: ${page.status_description}`,
  ].join('\n');
}
