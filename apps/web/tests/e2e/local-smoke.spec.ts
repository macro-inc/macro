import { expect, test } from '@playwright/test';

import { localE2ESeed } from './fixtures/local-e2e-seed';
import {
  expectEntityInCurrentList,
  gotoApp,
  LOCAL_E2E,
} from './helpers/local-app';

const SEEDED = {
  document: {
    id: localE2ESeed.smoke.projectRoadmap.document_id,
    name: localE2ESeed.smoke.projectRoadmap.document_name,
  },
  channel: {
    id: localE2ESeed.smoke.generalChannel.channel_id,
    name: localE2ESeed.smoke.generalChannel.channel_name ?? 'general',
    messageId: localE2ESeed.smoke.generalWelcomeMessage.message_id,
    message: localE2ESeed.smoke.generalWelcomeMessage.content,
  },
} as const;

test.skip(
  !LOCAL_E2E,
  'local smoke tests require LOCAL_E2E=true and seeded local data'
);

test.describe('local app smoke', () => {
  test.describe.configure({ timeout: 60_000 });

  test('documents view shows seeded documents', async ({ page }) => {
    await gotoApp(page, '/component/documents');
    await expect(page.locator('[data-list-view="documents"]')).toBeVisible({
      timeout: 30_000,
    });

    await expectEntityInCurrentList(
      page,
      SEEDED.document.id,
      SEEDED.document.name
    );
  });

  test('channels view and channel page show seeded channel data', async ({
    page,
  }) => {
    await gotoApp(page, '/component/channels');
    await expect(page.locator('[data-list-view="channels"]')).toBeVisible({
      timeout: 30_000,
    });

    await expectEntityInCurrentList(
      page,
      SEEDED.channel.id,
      SEEDED.channel.name
    );

    await gotoApp(
      page,
      `/channel/${SEEDED.channel.id}?channel_message_id=${SEEDED.channel.messageId}`
    );
    await expect(
      page.getByText(SEEDED.channel.name, { exact: true })
    ).toBeVisible();
    await expect(page.getByText(SEEDED.channel.message)).toBeVisible({
      timeout: 30_000,
    });
  });
});
