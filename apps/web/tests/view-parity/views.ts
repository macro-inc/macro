import { expect, type Locator, type Page } from '@playwright/test';

/** A view the two builds must render the same, with the states to compare. */
export type ParityView = {
  id: string;
  /** Path under `/app` the view opens at. */
  path: `/${string}`;
  /** Resolves once the view shows its content. */
  ready: (page: Page) => Promise<void>;
  /** States captured after the first, each compared too. */
  states: ParityState[];
};

export type ParityState = {
  name: string;
  /** Set for a step only a touch device can take, such as tapping the title. */
  only?: 'touch';
  go: (page: Page) => Promise<void>;
};

/** Presses as the device would: a tap on touch, a click otherwise. */
async function press(page: Page, target: Locator) {
  const touch = await page.evaluate(
    () => matchMedia('(pointer: coarse)').matches
  );
  if (touch) await target.tap();
  else await target.click();
}

const firstRow = (page: Page) =>
  page.locator('[data-entity-id]').filter({ visible: true }).first();

/** A list row by its visible name, from the seeded persona's starter content. */
const rowNamed = (page: Page, name: string) =>
  page
    .locator('[data-entity-id]')
    .filter({ hasText: name })
    .filter({ visible: true })
    .first();

/** Opens a document or task from its list and waits for its editor. */
const openDocument = (name: string) => async (page: Page) => {
  // The name, not the row's centre, where a phone row has a tag or a date.
  await press(page, rowNamed(page, name).getByText(name, { exact: true }));
  // Any value: a document the person can only read has an editor that is off.
  await expect(
    page.locator('[contenteditable]').filter({ visible: true }).first()
  ).toBeVisible();
};

/** Opens the title menu the way a touch header does: a tap on the title. */
const openTitleMenu = (name: string) => async (page: Page) => {
  const title = page.locator('[data-header-island]').filter({ hasText: name });
  await press(page, title.first());
  await expect(
    page.getByRole('dialog').filter({ visible: true }).first()
  ).toBeVisible();
};

/**
 * A block from the `view-parity-files` seed scenario, opened at the
 * preview route that mounts the block on every device. Sign in as
 * pat@seed.macro.local; the ids are the ones that scenario derives.
 */
const fileBlock = (block: string, id: string, name: string): ParityView => ({
  id: `file-${block}`,
  path: `/home/${block}/${id}`,
  ready: async (page) => {
    await expect(
      page.getByText(name, { exact: true }).filter({ visible: true }).first()
    ).toBeVisible();
  },
  states: [{ name: 'menu', only: 'touch', go: openTitleMenu(name) }],
});

/**
 * Add a view here when you split it. Steps use what a person would press, so
 * they run unchanged against the build before the split.
 */
export const PARITY_VIEWS: ParityView[] = [
  {
    id: 'mail',
    path: '/mail',
    ready: async (page) => {
      await expect(firstRow(page)).toBeVisible();
    },
    states: [
      {
        // Desktop opens the thread in the Mail view; touch opens its block.
        name: 'thread',
        go: async (page) => {
          await press(page, firstRow(page));
          await expect(page).toHaveURL(/\/(mail|email)\/[0-9a-f-]{36}/);
          await expect(
            page
              .getByText(/^Reply/)
              .filter({ visible: true })
              .first()
          ).toBeVisible();
        },
      },
    ],
  },
  {
    // Desktop opens the document in the Drive view; touch opens its block.
    id: 'document',
    path: '/drive',
    ready: async (page) => {
      await expect(rowNamed(page, 'Macro how to guide')).toBeVisible();
    },
    states: [
      { name: 'detail', go: openDocument('Macro how to guide') },
      { name: 'menu', only: 'touch', go: openTitleMenu('Macro how to guide') },
    ],
  },
  {
    id: 'task',
    path: '/tasks',
    ready: async (page) => {
      await expect(rowNamed(page, 'Intro to tasks')).toBeVisible();
    },
    states: [
      { name: 'detail', go: openDocument('Intro to tasks') },
      { name: 'menu', only: 'touch', go: openTitleMenu('Intro to tasks') },
    ],
  },
  {
    // Another person's task, so the header carries the access badge.
    id: 'shared-task',
    path: '/tasks',
    ready: async (page) => {
      await expect(rowNamed(page, 'Fix the perms edge case')).toBeVisible();
    },
    states: [
      { name: 'detail', go: openDocument('Fix the perms edge case') },
      {
        name: 'menu',
        only: 'touch',
        go: openTitleMenu('Fix the perms edge case'),
      },
    ],
  },
  fileBlock('image', '5eeda0ac-dfc9-80ad-b7af-d66208ffb667', 'Parity image'),
  fileBlock('video', '5eeda0ac-9040-8c7f-84a5-35426d903d05', 'Parity video'),
  fileBlock('code', '5eeda0ac-5d8d-80a5-b60d-8679e2e1941a', 'Parity code'),
  fileBlock(
    'unknown',
    '5eeda0ac-e29e-80e6-a4f3-c47c45ec8d72',
    'Parity archive'
  ),
  fileBlock('pdf', '5eeda0ac-c036-8d4d-a3f2-2e6bcc40f19f', 'Parity PDF'),
  fileBlock('canvas', '5eeda0ac-f380-8a34-b50f-cadebb2e0bc3', 'Parity canvas'),
  fileBlock('fig', '5eeda0ac-0e5e-8167-9b59-395e345c92aa', 'Parity design'),
  fileBlock('psd', '5eeda0ac-04a0-8421-9f7a-5b518722773e', 'Parity layers'),
  fileBlock('ai', '5eeda0ac-906f-8388-936e-0367c52b297a', 'Parity vector'),
  fileBlock('pptx', '5eeda0ac-edb0-8a25-8b6a-c3305e335dce', 'Parity slides'),
  fileBlock('write', '5eeda0ac-e5d7-8f83-b114-9c2860c37259', 'Parity words'),
  fileBlock('chat', '5eeda0ac-4d06-8b88-a612-9ce488531aba', 'Parity chat'),
];
