import { expect, test, type Page } from '@playwright/test';

import { localE2ESeed } from './fixtures/local-e2e-seed';
import {
  expectEntityInCurrentList,
  gotoApp,
  LOCAL_E2E,
} from './helpers/local-app';

const SIDEBAR_VIEWS = [
  { id: 'inbox', label: 'Inbox', heading: 'Inbox' },
  { id: 'search', label: 'Search', searchView: true },
  { id: 'agents', label: 'Agents', heading: 'Agents' },
  { id: 'mail', label: 'Email', heading: 'Email' },
  { id: 'documents', label: 'Documents', heading: 'Documents' },
  { id: 'tasks', label: 'Tasks', heading: 'Tasks' },
  { id: 'channels', label: 'Channels', heading: 'Channels' },
  { id: 'calls', label: 'Calls', heading: 'Calls' },
  { id: 'folders', label: 'Folders', heading: 'Folders' },
] as const;

test.skip(!LOCAL_E2E, 'local sidebar tests require LOCAL_E2E=true and seeded local data');

test.describe('local sidebar views', () => {
  test.describe.configure({ timeout: 60_000 });

  for (const view of SIDEBAR_VIEWS) {
    test(`opens ${view.label} from the sidebar`, async ({ page }) => {
      await gotoApp(
        page,
        view.id === 'documents' ? '/component/inbox' : '/component/documents'
      );

      await openSidebarView(page, view.label);
      await expect(page).toHaveURL(new RegExp(`/app/component/${view.id}$`));

      if ('searchView' in view) {
        await expect(page.locator('[data-soup-search]').first()).toBeVisible({
          timeout: 30_000,
        });
      } else {
        await expect(
          page.getByRole('heading', { name: view.heading })
        ).toBeVisible({ timeout: 30_000 });
      }

      if (view.id === 'documents') {
        await expectEntityInCurrentList(
          page,
          localE2ESeed.smoke.projectRoadmap.document_id,
          localE2ESeed.smoke.projectRoadmap.document_name
        );
      }

      if (view.id === 'channels') {
        await expectEntityInCurrentList(
          page,
          localE2ESeed.smoke.generalChannel.channel_id,
          localE2ESeed.smoke.generalChannel.channel_name ?? 'general'
        );
      }
    });
  }
});

async function openSidebarView(page: Page, label: string) {
  const button = page.locator('nav').getByRole('button', {
    name: label,
    exact: true,
  });
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click();
}
