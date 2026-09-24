/**
 * Idempotent upsert of MacroDB prod Datadog monitors.
 *
 * Finds existing monitors by tag managed:datadog-macrodb-alerts and name,
 * then updates or creates. Safe to re-run.
 *
 * Requires DD_API_KEY, DD_APP_KEY. Optional DD_SITE (default us5.datadoghq.com).
 */

import { MACRODB_PROD_MONITORS, type MonitorSpec } from './monitors';

const site = process.env.DD_SITE ?? 'us5.datadoghq.com';
const apiKey = process.env.DD_API_KEY;
const appKey = process.env.DD_APP_KEY;

if (!apiKey || !appKey) {
  console.error('DD_API_KEY and DD_APP_KEY are required');
  process.exit(1);
}

const baseUrl = `https://api.${site}`;

type MonitorSummary = {
  id: number;
  name: string;
  tags?: string[];
};

async function ddFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('DD-API-KEY', apiKey!);
  headers.set('DD-APPLICATION-KEY', appKey!);
  headers.set('Content-Type', 'application/json');
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

function toPayload(spec: MonitorSpec) {
  return {
    name: spec.name,
    type: spec.type,
    query: spec.query,
    message: spec.message,
    tags: spec.tags,
    priority: spec.priority,
    options: {
      thresholds: {
        critical: Number(spec.thresholds.critical),
        ...(spec.thresholds.warning !== undefined
          ? { warning: Number(spec.thresholds.warning) }
          : {}),
        ...(spec.thresholds.criticalRecovery !== undefined
          ? { critical_recovery: Number(spec.thresholds.criticalRecovery) }
          : {}),
        ...(spec.thresholds.warningRecovery !== undefined
          ? { warning_recovery: Number(spec.thresholds.warningRecovery) }
          : {}),
      },
      require_full_window: spec.requireFullWindow ?? false,
      evaluation_delay: spec.evaluationDelay ?? 60,
      notify_no_data: spec.notifyNoData ?? false,
      no_data_timeframe: spec.noDataTimeframe,
      include_tags: true,
      new_group_delay: 60,
      timeout_h: 0,
    },
  };
}

async function listManagedMonitors(): Promise<MonitorSummary[]> {
  const query = encodeURIComponent('tag:"managed:datadog-macrodb-alerts"');
  const response = await ddFetch(`/api/v1/monitor/search?query=${query}&per_page=100`);
  if (!response.ok) {
    throw new Error(
      `monitor search failed: ${response.status} ${await response.text()}`
    );
  }
  const body = (await response.json()) as {
    monitors?: MonitorSummary[];
  };
  return body.monitors ?? [];
}

async function createMonitor(spec: MonitorSpec): Promise<number> {
  const response = await ddFetch('/api/v1/monitor', {
    method: 'POST',
    body: JSON.stringify(toPayload(spec)),
  });
  if (!response.ok) {
    throw new Error(
      `create ${spec.name} failed: ${response.status} ${await response.text()}`
    );
  }
  const body = (await response.json()) as { id: number };
  return body.id;
}

async function updateMonitor(id: number, spec: MonitorSpec): Promise<void> {
  const response = await ddFetch(`/api/v1/monitor/${id}`, {
    method: 'PUT',
    body: JSON.stringify(toPayload(spec)),
  });
  if (!response.ok) {
    throw new Error(
      `update ${spec.name} (${id}) failed: ${response.status} ${await response.text()}`
    );
  }
}

async function main() {
  const existing = await listManagedMonitors();
  const byName = new Map(existing.map((monitor) => [monitor.name, monitor]));

  for (const spec of MACRODB_PROD_MONITORS) {
    const current = byName.get(spec.name);
    if (current) {
      await updateMonitor(current.id, spec);
      console.log(`updated ${spec.name} id=${current.id}`);
    } else {
      const id = await createMonitor(spec);
      console.log(`created ${spec.name} id=${id}`);
    }
  }

  console.log(`synced ${MACRODB_PROD_MONITORS.length} MacroDB monitors`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
