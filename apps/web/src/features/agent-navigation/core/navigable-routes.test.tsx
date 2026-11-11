import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoutesManifest, decodePane } from '@app/lib/split-router';
import { routeDefinitions } from '@app/lib/split-router/solid/route';
import { appRouteElements } from '@app/routes/app-router-view';
import { debugRoutes } from '@app/routes/routes';
import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { agentRouteTable, isNavigableByAgent } from './navigable-routes';

/** Rewrite the server's copy instead of comparing: `UPDATE_AGENT_ROUTE_TABLE=1`. */
const UPDATE = process.env.UPDATE_AGENT_ROUTE_TABLE === '1';

/**
 * Debug views are closed to agents and registered only in some builds
 * (`LOCAL_ONLY`, `DEV`, `DEV_MODE_ENV`), so the table leaves them out and
 * stays the same in every test environment. The server still refuses their
 * paths: `debug/<id>` and `component/<id>` fall to the closed `:type/:id`
 * branch.
 */
const DEBUG_ROUTES = new Set<string>(debugRoutes.map(({ route }) => route.id));

const SERVER_TABLE = resolve(
  __dirname,
  '../../../../../../crates/agents/agent_code_mode/src/domain/ui_commands/navigable_routes.json'
);

function appManifest() {
  return createRoot((dispose) => {
    const definitions = routeDefinitions(appRouteElements());
    dispose();

    return createRoutesManifest({
      definitions,
      defaultRoute: () => ({ matches: [{ id: 'base', params: {} }] }),
    });
  });
}

function navigable(path: string): boolean {
  const manifest = appManifest();
  const route = decodePane(manifest, path.split('/').filter(Boolean));
  if (!route) return false;

  return isNavigableByAgent(manifest, route);
}

describe('agent route table', () => {
  it('matches the copy the server checks paths against', () => {
    const branches = agentRouteTable(appManifest()).branches.filter(
      (branch) => !DEBUG_ROUTES.has(branch.route)
    );
    // One branch a line, so a route change reads as a small diff.
    const generated = [
      '{',
      '  "generatedBy": "apps/web/src/features/agent-navigation/core/navigable-routes.test.tsx",',
      '  "branches": [',
      branches.map((branch) => `    ${JSON.stringify(branch)}`).join(',\n'),
      '  ]',
      '}',
      '',
    ].join('\n');

    if (UPDATE) writeFileSync(SERVER_TABLE, generated);

    // Stale: run `UPDATE_AGENT_ROUTE_TABLE=1 bun run test -- navigable-routes` in apps/web.
    expect(readFileSync(SERVER_TABLE, 'utf8')).toBe(generated);
  });

  it('opens items and lists to agents', () => {
    for (const path of [
      '/drive/md/0190f5a4-0000-7000-8000-000000000001',
      '/md/0190f5a4-0000-7000-8000-000000000001',
      '/channels/0190f5a4-0000-7000-8000-000000000002',
      '/mail/0190f5a4-0000-7000-8000-000000000003',
      '/tasks',
    ]) {
      expect(navigable(path), path).toBe(true);
    }
  });

  it('keeps routes with side effects closed', () => {
    for (const path of [
      '/meet/join/token',
      '/signup',
      '/login',
      '/inbox-link-callback',
      '/mail/new',
      '/settings/api-keys',
      '/settings',
      '/debug/ui',
      '/component/ui',
      '/component/settings',
      '/pipedream-connect.html',
      '/routines/new',
    ]) {
      expect(navigable(path), path).toBe(false);
    }
  });
});
