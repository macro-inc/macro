import {
  here,
  msg,
  type RichMessage,
  toBody,
} from '../../../../packages/sdk/src/mentions';
import type { AlertPayload, AlertStatusPayload } from './goalert';

const MAX_DESCRIPTION_CHARS = 300;

// Datadog titles start with bracketed tags: `[P3] [Re-Triggered on {host:x}] [PROD] Title`.
const DATADOG_TAG = /^\s*\[([^\]]*)\]\s*/;
const SCOPE = /on \{(.+)\}/;
// Datadog's state line, from `alertMessage()` in infra/stacks/monitoring/notify.ts.
const DATADOG_STATE = /^(🔴|🟠|✅)\s*(CRITICAL|WARNING|RECOVERED):\s*(.*)$/u;
const GRAFANA_ROW = /^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|$/;
// `macro-db-prod.ctkwyjgndnfr.us-east-1.rds.amazonaws.com` -> `macro-db-prod`.
const AWS_HOSTNAME = /\b([a-z0-9-]+)\.[a-z0-9.-]+\.amazonaws\.com\b/g;
const LINK_LINE =
  /^(Runbook|Dashboard|Metric Graph|Source):\s*(https?:\/\/\S+)/;
const NOT_A_DESCRIPTION = ['@', '`', 'http', 'Metric value', 'Paging on-call'];
const GRAFANA_SEVERITY: Record<string, string> = {
  critical: '🔴 critical',
  warning: '🟠 warning',
};

/** A new-alert post, kept in parts so the headline can be rewritten on close. */
export type CompactPost = {
  /** Pages mention `@here`; the `Notify` service does not. */
  page: boolean;
  /** `🚨 **PAGE** · **<title> — <scope>**`, without the mention. */
  headline: string;
  /** State, description and links, one per line. */
  lines: string[];
};

type ParsedDetails = {
  state?: string;
  description?: string;
  scope?: string;
  links: Record<string, string>;
};

/** Whether alerts on this GoAlert service page on-call. */
export function isPage(serviceName: string): boolean {
  return !serviceName.includes('Notify');
}

/** `host:macro-db-prod.abc.us-east-1.rds.amazonaws.com` -> `macro-db-prod`. */
function shortScope(scope: string): string {
  return scope
    .split(',')
    .map((part) => {
      const value = part.slice(part.indexOf(':') + 1);
      return value.includes('.amazonaws.com') ? value.split('.')[0] : value;
    })
    .join(', ');
}

/** The title without Datadog's bracketed tags, and the group it fired on. */
function datadogTitle(summary: string): { title: string; scope: string } {
  let scope = '';
  let rest = summary;
  for (
    let match = DATADOG_TAG.exec(rest);
    match;
    match = DATADOG_TAG.exec(rest)
  ) {
    const on = SCOPE.exec(match[1]);
    if (on) scope = shortScope(on[1]);
    rest = rest.slice(match[0].length);
  }
  return { title: rest.trim(), scope };
}

/** The alert's cleaned-up title with the group it fired on. */
export function alertTitle(summary: string): string {
  const { title, scope } = datadogTitle(summary);
  return scope ? `${title} — ${scope}` : title;
}

/** Collapse whitespace, shorten AWS hostnames, and cut at a sentence end. */
export function firstSentences(text: string): string {
  const flat = text.split(/\s+/).filter(Boolean).join(' ');
  const short = flat.replace(AWS_HOSTNAME, '$1');
  if (short.length <= MAX_DESCRIPTION_CHARS) return short;
  const cut = short.slice(0, MAX_DESCRIPTION_CHARS);
  const sentenceEnd = cut.lastIndexOf('. ');
  const kept = sentenceEnd >= 0 ? cut.slice(0, sentenceEnd + 1) : cut.trimEnd();
  return kept || cut;
}

/** State, description and links from a Datadog message or Grafana's details table. */
function parseDetails(details: string): ParsedDetails {
  const parsed: ParsedDetails = { links: {} };
  const rows: Record<string, string> = {};
  for (const raw of details.split('\n')) {
    const line = raw.trim();
    const row = GRAFANA_ROW.exec(line);
    const state = DATADOG_STATE.exec(line);
    const link = LINK_LINE.exec(line);
    if (row) {
      rows[row[1]] = row[2];
    } else if (state) {
      parsed.state = `${state[1]} ${state[2].toLowerCase()}: ${state[3]}`;
    } else if (link) {
      parsed.links[link[1]] ??= link[2];
    } else if (
      line &&
      parsed.description === undefined &&
      parsed.state !== undefined &&
      !NOT_A_DESCRIPTION.some((prefix) => line.startsWith(prefix))
    ) {
      parsed.description = line;
    }
  }
  if (Object.keys(rows).length > 0) {
    const severity = rows.severity ?? '';
    parsed.state = GRAFANA_SEVERITY[severity] ?? severity;
    parsed.description = rows.description ?? '';
    parsed.scope =
      rows.DBInstanceIdentifier || rows.CacheClusterId || rows.QueueName || '';
    if (rows.panel_url) parsed.links.Graph = rows.panel_url;
    if (rows.runbook_url) parsed.links.Runbook = rows.runbook_url;
  }
  return parsed;
}

function markdownLinks(links: [string, string | undefined][]): string {
  return links
    .filter((link): link is [string, string] => Boolean(link[1]))
    .map(([name, url]) => `[${name}](${url})`)
    .join(' · ');
}

/**
 * ```
 * 🚨 **PAGE** · **macro-db-prod CPU high — macro-db-prod**
 * 🔴 critical: 92 (threshold 85)
 * macro-db-prod CPU averaged 92% over 15 minutes.
 * [Acknowledge](…) · [Graph](…) · [Runbook](…)
 * ```
 */
export function compactAlert(
  payload: Pick<
    AlertPayload,
    'Summary' | 'Details' | 'ServiceName' | 'GoAlertURL'
  >
): CompactPost {
  const page = isPage(payload.ServiceName);
  const parsed = parseDetails(payload.Details);
  let title = alertTitle(payload.Summary);
  if (parsed.scope && !title.includes(parsed.scope)) {
    title = `${title} — ${parsed.scope}`;
  }
  const lines: string[] = [];
  if (parsed.state) lines.push(parsed.state);
  if (parsed.description) lines.push(firstSentences(parsed.description));
  lines.push(
    markdownLinks([
      ['Acknowledge', payload.GoAlertURL],
      [
        'Graph',
        parsed.links.Graph ||
          parsed.links.Dashboard ||
          parsed.links['Metric Graph'],
      ],
      ['Runbook', parsed.links.Runbook],
    ])
  );
  return {
    page,
    headline: `${page ? '🚨 **PAGE**' : '🔔'} · **${title}**`,
    lines,
  };
}

/** The post body: a separator, the headline (`@here` on open pages), and the rest. */
export function renderPost(post: CompactPost, resolved = false): RichMessage {
  const rest = post.lines.join('\n');
  if (resolved) {
    // The mention is dropped so the edit does not notify everyone again.
    return toBody(`✅ Resolved · ${post.headline}\n${rest}`);
  }
  if (post.page) {
    return msg`${post.headline} ${here}\n${rest}`;
  }
  return toBody(`${post.headline}\n${rest}`);
}

/** What an `AlertStatus` log entry did to the alert. */
export type StatusChange = 'acknowledged' | 'closed' | 'escalated' | 'other';

export function statusChange(logEntry: string): StatusChange {
  const entry = logEntry.toLowerCase();
  if (entry.startsWith('acknowledged')) return 'acknowledged';
  if (entry.startsWith('closed')) return 'closed';
  if (entry.startsWith('escalated')) return 'escalated';
  return 'other';
}

const STATUS_EMOJI: Record<StatusChange, string> = {
  acknowledged: '👀',
  closed: '✅',
  escalated: '⏫',
  other: 'ℹ️',
};

/** One thread line for a status change: `👀 Acknowledged by Sam`. */
export function statusReply(logEntry: string): RichMessage {
  return toBody(`${STATUS_EMOJI[statusChange(logEntry)]} ${logEntry}`);
}

/** GoAlert re-sent an open alert (hourly re-escalation of an unacknowledged page). */
export function stillOpenReply(
  payload: Pick<AlertPayload, 'ServiceName' | 'GoAlertURL'>
): RichMessage {
  const line = `⏰ Still open · ${markdownLinks([['Acknowledge', payload.GoAlertURL]])}`;
  return isPage(payload.ServiceName) ? msg`${line} ${here}` : toBody(line);
}

/** A status change for an alert this bot never posted, as its own one-line post. */
export function statusPost(payload: AlertStatusPayload): RichMessage {
  const parts = [
    payload.LogEntry,
    alertTitle(payload.Summary),
    markdownLinks([['Open', payload.GoAlertURL]]),
  ].filter(Boolean);
  return toBody(`${parts.join(' · ')}`);
}

export function alertBundlePost(payload: {
  ServiceName: string;
  Count: number;
  GoAlertURL: string;
}): RichMessage {
  const page = isPage(payload.ServiceName);
  const line = `${page ? '🚨 **PAGE**' : '🔔'} · ${payload.Count} alerts on ${payload.ServiceName} · ${markdownLinks([['Acknowledge', payload.GoAlertURL]])}`;
  return page ? msg`${line} ${here}` : toBody(`${line}`);
}

export function alertStatusBundlePost(payload: {
  LogEntry: string;
  Count: number;
  GoAlertURL: string;
}): RichMessage {
  return toBody(
    `${payload.LogEntry} (${payload.Count} alerts) · ${markdownLinks([['Open', payload.GoAlertURL]])}`
  );
}

export function onCallPost(payload: {
  ScheduleName: string;
  ScheduleURL: string;
  Users: { Name: string }[];
}): RichMessage {
  const names = payload.Users.map((user) => user.Name).join(', ');
  return toBody(
    `On call for ${payload.ScheduleName}: ${names || 'nobody'}\n${payload.ScheduleURL}`
  );
}
