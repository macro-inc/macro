import { expect, type Page, test } from '@playwright/test';

const deliverJoinRequests = (page: Page) =>
  page.evaluate(() => window.calendarPreview.deliverJoinRequests());
const deliverContacts = (page: Page) =>
  page.evaluate(() => window.calendarPreview.deliverContacts());

// The two guest editors in the attendees header share one popover (a sheet
// on phones): Add guests for whoever may invite, Forward invitation for a
// guest who may not.
const GUEST_EDITORS = [
  {
    kind: 'add',
    label: 'Add guests',
    added: 'New guests',
    action: 'Send invitations',
  },
  {
    kind: 'forward',
    label: 'Forward invitation',
    added: 'Forward to',
    action: 'Forward',
  },
] as const;
type GuestEditor = (typeof GUEST_EDITORS)[number];

async function openDetails(page: Page, query: string) {
  await page.goto(`/?${query}`);
  const anchor = page.getByRole('button', {
    name: 'Planning review',
    exact: true,
  });
  await anchor.click();
  const details = page.getByRole('dialog', { name: 'Planning review' });
  await expect(details).toBeVisible();
  // Kobalte places the popover after it mounts; wait until it is beside the anchor.
  await expect
    .poll(async () => (await details.boundingBox())?.x ?? 0)
    .toBeGreaterThan(((await anchor.boundingBox())?.x ?? 0) + 1);
  return { anchor, details };
}

async function box(locator: ReturnType<Page['getByRole']>) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('Expected a laid-out element');
  return { ...rect, bottom: rect.y + rect.height };
}

async function openGuestEditor(page: Page, editor: GuestEditor, query: string) {
  const { anchor, details } = await openDetails(
    page,
    `guests=${editor.kind}&${query}`
  );
  const trigger = details.getByRole('button', {
    name: editor.label,
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: editor.label });
  await expect(dialog).toBeVisible();
  return { anchor, trigger, dialog };
}

/** Picks two people, then checks the picker, both of them and the action are fully visible. */
async function expectGuestEditorUsable(
  page: Page,
  editor: GuestEditor,
  dialog: ReturnType<Page['getByRole']>
) {
  for (const name of ['Avery Park', 'Blake Chen']) {
    await dialog.getByRole('option', { name }).click();
  }
  const added = dialog
    .getByRole('list', { name: editor.added })
    .getByRole('listitem');
  await expect(added).toHaveCount(2);
  await expect(dialog.getByPlaceholder('Add guests...')).toBeInViewport({
    ratio: 1,
  });
  for (const row of await added.all()) {
    await expect(row).toBeInViewport({ ratio: 1 });
  }
  await expect(
    dialog.getByRole('button', { name: editor.action, exact: true })
  ).toBeInViewport({ ratio: 1 });
  const viewport = page.viewportSize();
  const editorBox = await box(dialog);
  expect(editorBox.y).toBeGreaterThanOrEqual(0);
  expect(editorBox.bottom).toBeLessThanOrEqual(viewport?.height ?? 0);
}

test.describe('desktop popover', () => {
  test.skip(({ isMobile }) => isMobile, 'The phone shows a drawer');

  test.describe('tall window', () => {
    test.use({ viewport: { width: 1280, height: 1000 } });

    test('stays below the event when join requests arrive after opening', async ({
      page,
    }) => {
      const loaded = await openDetails(page, 'requests=loaded');
      const withRequests = (await box(loaded.details)).height;
      const pending = await openDetails(page, '');
      const opened = await box(pending.details);
      const withoutRequests = opened.height;
      // Where a start-aligned popover sits relative to its event's top.
      const startOffset = opened.y - (await box(pending.anchor)).y;
      expect(withRequests).toBeGreaterThan(withoutRequests + 40);

      // Put the event where the popover fits below it until the requests
      // arrive, with room above for the whole grown popover.
      const top = Math.round(1000 - 8 - (withRequests + withoutRequests) / 2);
      const { anchor, details } = await openDetails(page, `top=${top}`);
      const event = await box(anchor);
      expect(event.bottom).toBeGreaterThan(withRequests + 16);
      const before = await box(details);
      expect(Math.abs(before.y - event.y - startOffset)).toBeLessThanOrEqual(1);

      await deliverJoinRequests(page);
      await expect(
        details.getByRole('region', { name: 'Requests to join' })
      ).toBeVisible();
      await expect
        .poll(async () => Math.abs((await box(details)).height - withRequests))
        .toBeLessThan(2);
      const after = await box(details);
      // It slides up by what no longer fits instead of flipping above the event.
      expect(before.y - after.y).toBeLessThanOrEqual(
        after.height - before.height + 1
      );
      expect(after.bottom).toBeGreaterThan(event.bottom + 1);
      expect(after.bottom).toBeLessThanOrEqual(1000);
      await expect(
        details.getByRole('button', { name: 'Add as guest', exact: true })
      ).toBeInViewport({ ratio: 1 });
    });
  });

  test.describe('short window', () => {
    test.use({ viewport: { width: 1280, height: 560 } });

    test('slides the popover into view beside an event near the bottom', async ({
      page,
    }) => {
      const { anchor, details } = await openDetails(
        page,
        'requests=loaded&top=470'
      );
      const event = await box(anchor);
      const popover = await box(details);
      expect(popover.y).toBeGreaterThanOrEqual(0);
      expect(popover.bottom).toBeLessThanOrEqual(560);
      expect(popover.x).toBeGreaterThanOrEqual(event.x + event.width);
      await expect(
        details.getByRole('button', { name: 'Close event details' })
      ).toBeInViewport({ ratio: 1 });
      await expect(
        details.getByRole('button', { name: 'Add as guest', exact: true })
      ).toBeInViewport({ ratio: 1 });
    });
  });
});

test.describe('desktop guest editors', () => {
  test.skip(({ isMobile }) => isMobile, 'The phone shows a sheet');

  for (const editor of GUEST_EDITORS) {
    test.describe(editor.label, () => {
      test.describe('tall window', () => {
        test.use({ viewport: { width: 1280, height: 1000 } });

        test('moves above its button instead of squeezing when contacts arrive after it opens', async ({
          page,
        }) => {
          // Measure the editor before and after its suggestions arrive, and
          // where its button sits relative to the event.
          const measured = await openGuestEditor(page, editor, 'contacts=late');
          const empty = (await box(measured.dialog)).height;
          await deliverContacts(page);
          await expect
            .poll(async () => (await box(measured.dialog)).height)
            .toBeGreaterThan(empty + 100);
          const full = (await box(measured.dialog)).height;
          const buttonBottom =
            (await box(measured.trigger)).bottom -
            (await box(measured.anchor)).y;

          // Put the event where the editor fits below its button until the
          // suggestions arrive, with room above for the whole editor.
          const room = Math.round((empty + full) / 2);
          const top = Math.round(1000 - 8 - 4 - room - buttonBottom);
          const { anchor, trigger, dialog } = await openGuestEditor(
            page,
            editor,
            `contacts=late&top=${top}`
          );
          const button = await box(trigger);
          expect(
            Math.abs(button.bottom - (await box(anchor)).y - buttonBottom)
          ).toBeLessThanOrEqual(1);
          expect((await box(dialog)).y).toBeGreaterThan(button.bottom);

          await deliverContacts(page);
          await expect
            .poll(async () => (await box(dialog)).bottom)
            .toBeLessThan(button.y);
          await expectGuestEditorUsable(page, editor, dialog);
        });
      });

      test.describe('short window', () => {
        test.use({ viewport: { width: 1280, height: 560 } });

        test('slides into view beside an event near the bottom', async ({
          page,
        }) => {
          const { dialog } = await openGuestEditor(page, editor, 'top=470');
          await expectGuestEditorUsable(page, editor, dialog);
        });
      });
    });
  }
});

test('the phone sheets keep the picker, the chosen people and the action in view', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Desktop shows a popover');
  for (const editor of GUEST_EDITORS) {
    await page.goto(`/?guests=${editor.kind}`);
    await page
      .getByRole('button', { name: 'Planning review', exact: true })
      .click();
    const drawer = page.getByRole('dialog', { name: 'Planning review' });
    await expect(drawer).toBeVisible();
    await drawer
      .getByRole('button', { name: editor.label, exact: true })
      .click();
    const sheet = page.getByRole('dialog', { name: editor.label });
    await expect(sheet).toBeVisible();
    await expectGuestEditorUsable(page, editor, sheet);
  }
});

test('the phone drawer shows join requests that arrive after it opens', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Desktop shows a popover');
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Planning review', exact: true })
    .click();
  const drawer = page.getByRole('dialog', { name: 'Planning review' });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole('region', { name: 'Requests to join' })
  ).toHaveCount(0);

  await deliverJoinRequests(page);
  const requests = drawer.getByRole('region', { name: 'Requests to join' });
  await expect(requests).toBeVisible();
  await requests
    .getByRole('button', { name: 'Add as guest', exact: true })
    .click();
  // The modal drawer hides the page behind it from the accessibility tree.
  await expect(page.locator('[aria-label="Preview action"]')).toHaveText(
    'Invited member@example.com'
  );
  await expect(requests).toHaveCount(0);
});
