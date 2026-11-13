import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { type ResultError, ThrownResultError } from '@core/util/result';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import type { Dashboard, DashboardFailure } from '../core/dashboard';

// Hand-written until the storage service's OpenAPI lands; then the requests
// here become calls into the generated client (`bun run gen-api`).

type DashboardWidget = Dashboard['view']['widgets'][number];

/**
 * The server decodes every view (`decode_view`) before storing it, so the
 * renderer takes it as serialized; only the envelope is checked here.
 */
const DASHBOARD = z.object({
  id: z.string(),
  ownerId: z.string(),
  title: z.string().nullable(),
  version: z.number(),
  view: z.object({
    title: z.string().optional(),
    widgets: z.array(
      z.custom<DashboardWidget>(
        (value) =>
          typeof value === 'object' &&
          value !== null &&
          'type' in value &&
          typeof value.type === 'string'
      )
    ),
  }),
  accessLevel: z.enum(['view', 'comment', 'edit', 'owner']),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DashboardFetch = (
  url: string
) => Promise<Result<unknown, ResultError[]>>;

const fetchJson: DashboardFetch = (url) =>
  fetchWithToken<object>(url, { method: 'GET' });

function dashboardsRoot(): string {
  return `${SERVER_HOSTS['document-storage-service']}/dashboards`;
}

async function readDashboard(
  url: string,
  fetcher: DashboardFetch
): Promise<Result<Dashboard, ResultError[]>> {
  const response = await fetcher(url);
  if (response.isErr()) return err(response.error);

  const parsed = DASHBOARD.safeParse(response.value);
  if (!parsed.success) {
    return err([{ code: 'INVALID_JSON', message: 'Unexpected dashboard' }]);
  }
  return ok(parsed.data);
}

/** The account's home dashboard; 404 when it has none or the viewer can't see it. */
export function fetchHomeDashboard(
  userId: string,
  fetcher: DashboardFetch = fetchJson
): Promise<Result<Dashboard, ResultError[]>> {
  return readDashboard(
    `${dashboardsRoot()}/home/${encodeURIComponent(userId)}`,
    fetcher
  );
}

export function fetchDashboard(
  dashboardId: string,
  fetcher: DashboardFetch = fetchJson
): Promise<Result<Dashboard, ResultError[]>> {
  return readDashboard(
    `${dashboardsRoot()}/${encodeURIComponent(dashboardId)}`,
    fetcher
  );
}

/** Reads a failed query's error as the feature's failure. */
export function dashboardFailure(error: unknown): DashboardFailure {
  if (!(error instanceof ThrownResultError)) return 'failed';

  const codes: readonly string[] = error.errors.map((each) => each.code);
  if (codes.includes('NOT_FOUND')) return 'missing';
  if (codes.includes('FORBIDDEN')) return 'forbidden';
  return 'failed';
}
