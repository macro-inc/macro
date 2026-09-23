import * as path from 'node:path';
import { $ } from 'bun';
import { services } from '../services';

// Services whose OpenAPI spec is copied from apps/web's service-clients package,
// where `apps/web`'s `gen-api` writes each Rust service's spec. `calendar` is not
// among them: its paths need the `/calendar` prefix stripped (see
// `stripCalendarPrefix`), so its spec is generated here directly from the Rust
// `calendar_service_openapi` binary. See `syncCalendarSpec`.
const serviceClientDirectories = {
  'agent-harness': 'service-agent-harness',
  auth: 'service-auth',
  cognition: 'service-cognition',
  connection: 'service-connection',
  contacts: 'service-contacts',
  email: 'service-email',
  notification: 'service-notification',
  properties: 'service-properties',
  'scheduled-action': 'service-scheduled-action',
  search: 'service-search',
  'static-files': 'service-static-files',
  storage: 'service-storage',
  unfurl: 'service-unfurl',
} satisfies Record<Exclude<(typeof services)[number], 'calendar'>, string>;

const serviceClientsDirectory = path.resolve(
  import.meta.dirname,
  '../../../apps/web/src/lib/service-clients',
);
const specsDirectory = path.resolve(import.meta.dirname, '../specs');
const rustWorkspaceDirectory = path.resolve(import.meta.dirname, '../../..');

/**
 * Rewrite calendar_service's OpenAPI so its paths are root-relative.
 *
 * The calendar mutation handlers are shared with email-service, whose spec must
 * keep serving them under `/calendar/*` (email base is `/email`). Their
 * `utoipa::path` annotations therefore carry a `/calendar` prefix. The SDK's
 * calendar client instead carries `/calendar` in its base URL (dev/prod
 * `<gateway>/calendar`), so the generated paths must drop it. Stripping here
 * keeps the annotations untouched — and so keeps email-service's spec, and the
 * apps/web spec generated from it, byte-for-byte unchanged.
 *
 * Temporary: once email-service stops serving `/calendar/*` (cutover cleanup),
 * the shared annotations can become router-relative and this transform goes away.
 */
function stripCalendarPrefix(spec: string): string {
  const doc = JSON.parse(spec) as { paths?: Record<string, unknown> };
  if (doc.paths) {
    const rewritten: Record<string, unknown> = {};
    for (const [route, item] of Object.entries(doc.paths)) {
      const stripped = route.startsWith('/calendar/')
        ? route.slice('/calendar'.length)
        : route;
      rewritten[stripped] = item;
    }
    doc.paths = rewritten;
  }
  return `${JSON.stringify(doc, null, 2)}\n`;
}

async function syncCalendarSpec(destination: string): Promise<void> {
  const spec = await $`cargo run --quiet --bin calendar_service_openapi`
    .cwd(rustWorkspaceDirectory)
    .env({ ...process.env, SQLX_OFFLINE: 'true' })
    .text();
  await Bun.write(destination, stripCalendarPrefix(spec));
  console.log('Synced calendar (from calendar_service_openapi)');
}

for (const service of services) {
  const destination = path.join(specsDirectory, `${service}.json`);

  if (service === 'calendar') {
    await syncCalendarSpec(destination);
    continue;
  }

  const source = path.join(
    serviceClientsDirectory,
    serviceClientDirectories[service],
    'openapi.json',
  );
  await Bun.write(destination, Bun.file(source));
  console.log(`Synced ${service}`);
}
