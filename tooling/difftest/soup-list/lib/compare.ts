/**
 * Compares what the old and the new reader return, at two levels.
 *
 * Data: every field of every row, after aligning rows by id. A field that
 * differs is either explained by a named rule (counted, with its cause and the
 * evidence that callers cannot see it) or reported as a difference.
 *
 * Caller: the projection each caller renders or acts on (rows, labels, order,
 * counts, enabled state, menu items). It must match exactly; a data-level rule
 * is harmless only while the caller-level comparison of the same snapshot
 * matches.
 */

export type Diff = { path: string; old: unknown; new: unknown };

export type Rule = {
  id: string;
  /** file:line of the cause, on the PR head. */
  cause: string;
  /** Why callers cannot see it; checked by the caller-level comparison. */
  evidence: string;
  applies: (path: string, key: string, oldValue: unknown, newValue: unknown) => boolean;
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function sameInstant(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (!ISO.test(a) || !ISO.test(b)) return false;
  // Date keeps milliseconds; compare the fraction past them as text too.
  const frac = (s: string) => (s.match(/\.(\d+)/)?.[1] ?? '').padEnd(9, '0');
  return Date.parse(a) === Date.parse(b) && frac(a) === frac(b);
}

const GQL = 'apps/web/src/lib/service-clients/service-storage/graphql-soup.ts';

export const DATA_RULES: Rule[] = [
  {
    id: 'timestamp-offset',
    cause: `${GQL}: GraphQL DateTime serializes "+00:00" where REST serializes "Z"`,
    evidence:
      'Same instant to the nanosecond; every caller parses timestamps (new Date / Date.parse / formatDate), and the caller-level comparison compares the parsed values.',
    applies: (_p, _k, o, n) => sameInstant(o, n),
  },
  {
    id: 'document-version-zero',
    cause: `${GQL}:2192 sets documentVersionId: 0 for every GraphQL document`,
    evidence:
      'Read only by file viewers and downloads (drive-view details, block-pdf, file-document.ts), which load the document by id themselves; none of the moved callers read it.',
    applies: (_p, k, o, n) => k === 'documentVersionId' && typeof o === 'number' && n === 0,
  },
  {
    id: 'document-sha-absent',
    cause: `${GQL}:2175-2197 maps no sha onto GraphQL documents`,
    evidence:
      'Read only by docx/attachment download and change sets (getDocxFile.ts, changeset.ts); none of the moved callers read it.',
    applies: (_p, k, o, n) => k === 'sha' && typeof o === 'string' && n === undefined,
  },
  {
    id: 'deleted-at-null-undefined',
    cause: `${GQL}:2191 maps a null deletedAt to undefined`,
    evidence:
      'Readers test it for truthiness (QuickAccessSource.tsx:502 `if (item.deletedAt) continue`); null and undefined behave the same.',
    applies: (_p, k, o, n) => k === 'deletedAt' && o === null && n === undefined,
  },
  {
    id: 'appearance-null',
    cause: `${GQL}:2182 sets appearance from readEntityAppearance, null when unset; REST omits it`,
    evidence:
      'Readers go through readEntityAppearance / optional chaining, where null and absent are the same unset appearance.',
    applies: (_p, k, o, n) => k === 'appearance' && o === undefined && n === null,
  },
  {
    id: 'property-definition-timestamps',
    cause: `${GQL}:1221-1222 fills a property definition's created_at/updated_at with ""`,
    evidence:
      'Definition timestamps are read only by the property editors (property/utils/transforms.ts, project-properties.ts), which load definitions themselves; list rows read display_name, data_type and value.',
    applies: (p, k, o, n) =>
      /\.definition$/.test(p) && (k === 'created_at' || k === 'updated_at') && typeof o === 'string' && n === '',
  },
  {
    id: 'crm-domain-synthetic',
    cause: `${GQL}:2481-2486 builds a CRM domain's id as "<companyId>:<domain>" with the company's createdAt`,
    evidence:
      'Callers read domains[].domain (company suggestions, export); no caller reads a domain id or its createdAt.',
    applies: (p, k, o, n) =>
      /\.domains\[[^\]]+\]$/.test(p) &&
      ((k === 'id' && typeof n === 'string' && n.includes(':')) ||
        (k === 'createdAt' && typeof o === 'string' && typeof n === 'string')),
  },
  {
    id: 'preview-notifications-empty',
    cause:
      'apps/web/src/lib/queries/soup/items.ts:381 (graphqlProjection): QUICK_ACCESS_FEED_OPTIONS selects SoupPreviewPage, rows without notifications',
    evidence:
      'Only lists that set ignoresNotifications use it, and those never read notifications (the caller-level projection of each holds no notification state).',
    applies: (_p, k, o, n) =>
      k === 'notifications' &&
      (o === undefined || (Array.isArray(o) && o.length === 0)) &&
      Array.isArray(n) &&
      n.length === 0,
  },
  {
    id: 'viewed-at-null-undefined',
    cause: `${GQL}:2190 maps a null viewedAt to undefined`,
    evidence:
      'Readers coalesce it (QuickAccessSource.tsx `viewedAtMap.get(id) ?? x.viewedAt`, toTimestamp); the caller-level projection parses both to null.',
    applies: (_p, k, o, n) => k === 'viewedAt' && o === null && n === undefined,
  },
  {
    id: 'property-value-null',
    cause: `${GQL}:1155 returns a missing property value as null; REST omits the key`,
    evidence:
      'Property readers check `value !== null && value !== undefined` (features/property/api/converters.ts:36-46) and formatting treats both as empty (features/property/utils/formatting.ts:90).',
    applies: (p, k, o, n) => /\.properties\[[^\]]*\]$/.test(p) && k === 'value' && o === undefined && n === null,
  },
  {
    id: 'agent-session-graphql-fields',
    cause: `${GQL}:2117-2118 maps bot and threadId, which the REST agent-session row lacks`,
    evidence:
      'Extra fields only; the caller-level quick-access comparison shows whether any caller reads them (QuickAccessSource.tsx:857 reads bot?.name into searchText).',
    applies: (p, k, o, _n) => /\[agent_session:[^\]]+\]$/.test(p) && (k === 'bot' || k === 'threadId') && o === undefined,
  },
  {
    id: 'property-definition-owner-system',
    cause: `${GQL}:1220 sets every GraphQL property definition's owner to { scope: 'system' }; REST carries the real owner`,
    evidence:
      'The task row (TaskListEntity → task-grid-layout.tsx) looks properties up by definition id and never reads owner; task-properties.ts:168 checks is_system first because GraphQL rows carry no owner. Same mapper on main (fuzz: main == branch).',
    applies: (p, k, o, n) =>
      /\.definition\.owner$/.test(p) && ((k === 'scope' && n === 'system') || (k === 'user_id' && n === undefined) || (k === 'team_id' && n === undefined)) && o !== n,
  },
  {
    id: 'channel-graphql-fields',
    cause: `${GQL}:2350 maps a null interactedAt to undefined, and :2355 adds notifications to channel rows, which REST channel rows omit`,
    evidence:
      'Channel rows only; no moved caller asks for channels (their filters name document, agent-session, initiative, CRM and foreign-entity targets). Main reads channels through this same mapper (fuzz: main == branch).',
    applies: (p, k, o, n) =>
      /\[channel:[^\]]+\]$/.test(p) && ((k === 'interactedAt' && o === null && n === undefined) || (k === 'notifications' && o === undefined && Array.isArray(n))),
  },
  {
    id: 'thread-graphql-fields',
    cause: `${GQL}:2379-2399 maps no editedAt onto channel threads, sets thread.latest_reply_at from effectiveUpdatedAt (REST: null without replies) and adds notifications, which REST thread rows omit`,
    evidence:
      'Channel-thread rows only; no moved caller asks for threads. Main reads threads through this same mapper (fuzz: main == branch).',
    applies: (p, k, o, n) =>
      /\[channel_thread:[^\]]+\](\.thread)?$/.test(p) &&
      ((k === 'editedAt' && o === null && n === undefined) ||
        (k === 'latestReplyAt' && o === null && typeof n === 'string') ||
        (k === 'notifications' && o === undefined && Array.isArray(n))),
  },
];

/**
 * For readers with ignoresNotifications only: main's REST rows carry
 * notifications, the branch's preview rows carry none.
 */
export const PREVIEW_DROPS_NOTIFICATIONS: Rule = {
  id: 'preview-drops-notifications',
  cause:
    'apps/web/src/lib/queries/soup/items.ts:381 selects the preview projection (no notifications) when ignoresNotifications is set; main has no such option and reads them',
  evidence:
    'Set only by QUICK_ACCESS_FEED_OPTIONS readers, whose caller projections hold no notification state (checked in the caller suite).',
  // The preview selection leaves the field out (undefined) or empty.
  applies: (_p, k, o, n) => k === 'notifications' && Array.isArray(o) && (n === undefined || (Array.isArray(n) && n.length === 0)),
};

export type DataResult = {
  equal: boolean;
  diffs: Diff[];
  ruleHits: Record<string, number>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rowKey(row: unknown, arrayKey = ''): string | undefined {
  if (!isObject(row)) return undefined;
  // CRM domains: the GraphQL id is synthetic (rule crm-domain-synthetic); align by the domain.
  if (arrayKey === 'domains' && typeof row.domain === 'string') return `domain:${row.domain}`;
  const id = row.id;
  const type = row.type;
  return typeof id === 'string' ? `${typeof type === 'string' ? type : ''}:${id}` : undefined;
}

/** Deep comparison with rules; arrays of rows are aligned by id. */
export function compareData(
  oldValue: unknown,
  newValue: unknown,
  rules: Rule[] = DATA_RULES,
  limit = 50
): DataResult {
  const diffs: Diff[] = [];
  const ruleHits: Record<string, number> = {};
  const push = (diff: Diff) => {
    if (diffs.length < limit) diffs.push(diff);
    else if (diffs.length === limit) diffs.push({ path: '…', old: 'more', new: 'more' });
  };
  const walk = (path: string, key: string, o: unknown, n: unknown) => {
    if (o === n) return;
    if (Array.isArray(o) && Array.isArray(n)) {
      const oKeys = o.map((row) => rowKey(row, key));
      const nKeys = n.map((row) => rowKey(row, key));
      if (oKeys.every(Boolean) && nKeys.every(Boolean)) {
        if (oKeys.join('|') !== nKeys.join('|')) {
          push({ path: `${path}#rows`, old: oKeys, new: nKeys });
        }
        const byKey = new Map(n.map((row, i) => [nKeys[i], row] as const));
        o.forEach((row, i) => {
          const other = byKey.get(oKeys[i]);
          if (other !== undefined) walk(`${path}[${oKeys[i]}]`, String(i), row, other);
        });
        return;
      }
      if (o.length !== n.length) push({ path: `${path}#length`, old: o.length, new: n.length });
      for (let i = 0; i < Math.min(o.length, n.length); i++)
        walk(`${path}[${i}]`, String(i), o[i], n[i]);
      return;
    }
    if (isObject(o) && isObject(n)) {
      for (const k of new Set([...Object.keys(o), ...Object.keys(n)]))
        walk(`${path}.${k}`, k, o[k], n[k]);
      return;
    }
    if (Number.isNaN(o) && Number.isNaN(n)) return;
    for (const rule of rules) {
      if (rule.applies(path.slice(0, path.length - key.length - 1), key, o, n)) {
        ruleHits[rule.id] = (ruleHits[rule.id] ?? 0) + 1;
        return;
      }
    }
    push({ path, old: o, new: n });
  };
  walk('', '', oldValue, newValue);
  return { equal: diffs.length === 0, diffs, ruleHits };
}

/** Exact comparison of caller projections (timestamps already parsed). */
export function compareCaller(oldView: unknown, newView: unknown): DataResult {
  return compareData(oldView, newView, []);
}

export function ms(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}
