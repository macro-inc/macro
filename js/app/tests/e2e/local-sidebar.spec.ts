import { expect, type Locator, type Page, test } from '@playwright/test';
import { soupListContainerSelector } from '../../packages/core/dom-selectors';

import { localE2ESeed } from './fixtures/local-e2e-seed';
import {
  expectEntityInCurrentList,
  gotoApp,
  LOCAL_E2E,
} from './helpers/local-app';

const SIDEBAR_LIST_VIEWS = [
  { id: 'inbox', label: 'Inbox', tabs: ['Signal', 'Noise', 'All'] },
  { id: 'search', label: 'Search', tabs: [] },
  {
    id: 'agents',
    label: 'Agents',
    tabs: ['Owned', 'Running', 'Shared', 'Automations'],
  },
  {
    id: 'mail',
    label: 'Email',
    tabs: ['Signal', 'Noise', 'Calendar', 'Sent', 'Drafts', 'Shared', 'All'],
  },
  {
    id: 'documents',
    label: 'Documents',
    tabs: ['Owned', 'Shared', 'Attachments', 'All'],
  },
  { id: 'tasks', label: 'Tasks', tabs: ['Assigned', 'Created', 'All'] },
  { id: 'channels', label: 'Channels', tabs: ['Recent', 'People', 'Teams'] },
  { id: 'calls', label: 'Calls', tabs: ['All', 'Unattended'] },
  { id: 'folders', label: 'Folders', tabs: ['Owned', 'All'] },
] as const;

test.skip(
  !LOCAL_E2E,
  'local sidebar tests require LOCAL_E2E=true and seeded local data'
);

test.describe('local sidebar views', () => {
  test.describe.configure({ timeout: 60_000 });

  for (const view of SIDEBAR_LIST_VIEWS) {
    test(`opens ${view.label} from the sidebar`, async ({ page }) => {
      await gotoApp(
        page,
        view.id === 'documents' ? '/component/inbox' : '/component/documents'
      );

      await openSidebarView(page, view.id);

      await expect(page).toHaveURL(new RegExp(`/app/component/${view.id}$`));
      await expectActiveSidebarLink(page, view.id);
      await expectLoadedListView(page, view.id);
      await expectListViewChrome(page, view.tabs);

      if (view.id === 'search') {
        await expect(page.locator('[data-soup-search]').first()).toBeVisible({
          timeout: 30_000,
        });
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

async function openSidebarView(page: Page, id: string) {
  const link = sidebarLink(page, id);
  await expect(link).toBeVisible({ timeout: 30_000 });
  await link.click();
}

async function expectActiveSidebarLink(page: Page, id: string) {
  await expect(sidebarLink(page, id)).toHaveAttribute('data-active', '', {
    timeout: 10_000,
  });
}

async function expectLoadedListView(page: Page, id: string) {
  const view = page.locator(`[data-list-view="${id}"]`).first();
  await expect(view).toBeVisible({ timeout: 30_000 });
  await expect(
    view
      .locator(`${soupListContainerSelector}, [data-soup-empty-state]`)
      .first()
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Something went terribly wrong')).toHaveCount(0);
}

async function expectListViewChrome(page: Page, tabs: readonly string[]) {
  const header = page.locator('[data-split-header]').first();
  await expect(header).toBeVisible({ timeout: 30_000 });

  if (tabs.length === 0) return;

  for (const tab of tabs) {
    await expect(header.getByText(tab, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  }
}

function sidebarLink(page: Page, id: string): Locator {
  return page.locator(`nav [data-sidebar-link="${id}"]`).first();
}
