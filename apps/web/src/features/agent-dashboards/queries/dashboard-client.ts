import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { type ResultError, ThrownResultError } from '@core/util/result';
import type { Dashboard as DashboardDto } from '@service-storage/generated/schemas/dashboard';
import { getDashboardResponse } from '@service-storage/generated/zod';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import type { Dashboard, DashboardFailure } from '../core/dashboard';

type DashboardWidget = Dashboard['view']['widgets'][number];

/**
 * The generated response schema, with the view kept whole: on the wire it is
 * an opaque object (the server decodes it with `decode_view` before saving),
 * which the generated `object({})` would strip. Only its widget list is
 * checked here; the renderer takes the view as serialized.
 */
const DASHBOARD_RESPONSE = getDashboardResponse.extend({
  view: z.looseObject({
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
});

function toDashboard(dto: DashboardDto, view: Dashboard['view']): Dashboard {
  return {
    id: dto.id,
    ownerId: dto.ownerId,
    title: dto.title ?? null,
    version: dto.version,
    view,
    accessLevel: dto.accessLevel,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

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

  const parsed = DASHBOARD_RESPONSE.safeParse(response.value);
  if (!parsed.success) {
    return err([{ code: 'INVALID_JSON', message: 'Unexpected dashboard' }]);
  }
  const { title, widgets } = parsed.data.view;
  const view = title === undefined ? { widgets } : { title, widgets };
  return ok(toDashboard(parsed.data, view));
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
