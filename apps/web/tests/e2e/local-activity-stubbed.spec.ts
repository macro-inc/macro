import { expect, test } from '@playwright/test';

import { localE2ESeed } from './fixtures/local-e2e-seed';
import { stubSoupGraphql } from './helpers/graphql-stub';
import {
  createDocument,
  gotoApp,
  LOCAL_E2E,
  openSidePanelSection,
} from './helpers/local-app';

test.skip(
  !LOCAL_E2E,
  'local activity tests require LOCAL_E2E=true and a running local stack'
);

const ACTOR = 'macro|stub-actor@macro.local';

function wireEvent(
  id: string,
  action: Record<string, unknown>,
  entity: { type: string; id: string } = {
    type: 'DOCUMENT',
    id: localE2ESeed.smoke.projectRoadmap.document_id,
  }
) {
  return {
    __typename: 'GraphqlActivityEvent',
    id,
    actorId: ACTOR,
    subjectId: ACTOR,
    entityType: entity.type,
    entityId: entity.id,
    occurredAt: '2026-08-29T12:00:00.000Z',
    action,
  };
}

const FIRST_PAGE = [
  wireEvent('stub-1', { __typename: 'GraphqlActivityCreated' }),
  wireEvent('stub-2', { __typename: 'GraphqlActivityEdited' }),
  wireEvent('stub-3', { __typename: 'GraphqlActivityOpened' }),
];
const SECOND_PAGE = [
  wireEvent('stub-4', {
    __typename: 'GraphqlActivityCallStarted',
    callId: 'c',
  }),
  wireEvent('stub-5', { __typename: 'GraphqlActivityDeleted' }),
];

/**
 * The feed and side panel against a scripted backend: pagination follows the
 * cursor the server hands back, and an entity the soup does not know about
 * reads as unavailable rather than as an empty history. No seed dependence.
 */
test.describe('local activity (stubbed GraphQL)', () => {
  test.describe.configure({ timeout: 60_000 });

  test('pages the feed through the returned cursor', async ({ page }) => {
    await stubSoupGraphql(page, ({ operationName, variables }) => {
      if (operationName === 'MyActivityOverview') {
        return {
          data: {
            user: {
              id: 'user-stub',
              activityOverview: {
                from: '2025-09-01',
                to: '2026-09-01',
                timeZone: 'UTC',
                total: 5,
                days: [{ date: '2026-08-29', count: 5 }],
                topEntities: [],
              },
            },
          },
        };
      }
      if (operationName === 'MyActivity') {
        const cursor = (variables.input as { cursor: string | null }).cursor;
        const page = cursor === 'stub-cursor' ? SECOND_PAGE : FIRST_PAGE;
        return {
          data: {
            user: {
              id: 'user-stub',
              activity: {
                items: page,
                nextCursor: cursor === 'stub-cursor' ? null : 'stub-cursor',
              },
            },
          },
        };
      }
      return undefined;
    });

    await gotoApp(page, '/component/activity');
    const rows = page.locator('[data-activity-row]');
    await expect(rows).toHaveCount(FIRST_PAGE.length, { timeout: 30_000 });
    await expect(page.getByText('Actions (5)')).toBeVisible();

    await page.getByRole('button', { name: 'Show more' }).click();
    await expect(rows).toHaveCount(FIRST_PAGE.length + SECOND_PAGE.length);
    await expect(
      page.locator('[data-activity-row][data-activity-action="call-started"]')
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(
      0
    );
  });

  test('reads a missing soup entity as unavailable', async ({ page }) => {
    await stubSoupGraphql(page, ({ operationName }) =>
      operationName === 'EntityActivity'
        ? { data: { user: { id: 'user-stub', soup: { items: [] } } } }
        : undefined
    );

    await gotoApp(page, '/component/activity');
    await createDocument(page);
    await openSidePanelSection(page, 'Activity');
    await expect(page.getByText('Activity is unavailable')).toBeVisible({
      timeout: 30_000,
    });
  });
});
