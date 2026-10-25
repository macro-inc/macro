import { expect, test } from '@playwright/test';

test('full-detail team viewers can link and open notes without provider actions', async ({
  page,
}) => {
  await page.goto('/?team=details');
  const notes = page.getByRole('region', { name: 'Meeting notes' });
  await notes
    .getByRole('button', { name: 'Link existing', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Link meeting notes' });
  await dialog
    .getByRole('button', { name: 'Weekly product sync', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Link note', exact: true }).click();
  await notes
    .getByRole('button', { name: 'Open Weekly product sync', exact: true })
    .click();
  await expect(page.getByRole('status', { name: 'Preview action' })).toHaveText(
    'Opened Weekly product sync'
  );

  await page
    .getByRole('button', { name: 'Weekly product sync', exact: true })
    .click();
  await expect(notes).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Yes', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Edit event', exact: true })
  ).toHaveCount(0);

  await page.goto('/?team=busy');
  await expect(
    page.getByRole('button', { name: 'Close event details', exact: true })
  ).toBeVisible();
  await expect(notes).toHaveCount(0);
});

test('a note tooltip does not block selecting a neighboring document', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Touch devices do not show hover tooltips');
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Link existing', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Link meeting notes' });
  await dialog
    .getByRole('button', { name: 'Weekly product sync', exact: true })
    .hover();
  await expect(page.getByRole('tooltip', { includeHidden: true })).toHaveText(
    'Weekly product sync'
  );
  await dialog
    .getByRole('button', { name: 'Q4 product roadmap', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Link note', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open Q4 product roadmap', exact: true })
  ).toBeVisible();
});

test('create and open multiple notes with meeting access and no team sharing', async ({
  page,
}) => {
  await page.goto('/');
  const notes = page.getByRole('region', { name: 'Meeting notes' });
  await notes
    .getByRole('button', { name: 'Create notes', exact: true })
    .click();
  await expect(page.getByRole('status', { name: 'Preview action' })).toHaveText(
    'Opened Weekly product sync notes'
  );
  await expect(notes).not.toBeVisible();
  await page
    .getByRole('button', { name: 'Weekly product sync', exact: true })
    .click();
  await expect(
    notes.getByRole('button', {
      name: 'Open Weekly product sync notes',
      exact: true,
    })
  ).toHaveCount(1);
  await expect(notes).not.toContainText('Also shared with Macro');
  await notes
    .getByRole('button', { name: 'Create notes', exact: true })
    .click();
  await expect(notes).not.toBeVisible();
  await page
    .getByRole('button', { name: 'Weekly product sync', exact: true })
    .click();
  await expect(
    notes.getByRole('button', {
      name: 'Open Weekly product sync notes',
      exact: true,
    })
  ).toHaveCount(2);
  await expect(
    notes.getByRole('button', { name: 'Options for Weekly product sync notes' })
  ).toHaveCount(2);
});

test('retry linking a newly created note without duplicating the document', async ({
  page,
}) => {
  await page.goto('/?fail=1');
  const notes = page.getByRole('region', { name: 'Meeting notes' });
  await notes
    .getByRole('button', { name: 'Create notes', exact: true })
    .click();
  await expect(notes.getByRole('alert')).toContainText('Your note was saved');
  await expect(
    notes.getByRole('button', { name: 'Open saved note' })
  ).toBeVisible();
  await notes
    .getByRole('button', { name: 'Retry linking', exact: true })
    .click();
  await expect(notes).not.toBeVisible();
  await page
    .getByRole('button', { name: 'Weekly product sync', exact: true })
    .click();
  await expect(
    notes.getByRole('button', {
      name: 'Open Weekly product sync notes',
      exact: true,
    })
  ).toHaveCount(1);
  await notes.getByRole('button', { name: 'Link existing' }).click();
  const dialog = page.getByRole('dialog', { name: 'Link meeting notes' });
  await expect(
    dialog.getByRole('button', {
      name: 'Weekly product sync notes',
      exact: true,
    })
  ).toHaveCount(1);
  await expect(
    dialog.getByRole('button', {
      name: 'Weekly product sync notes',
      exact: true,
    })
  ).toBeDisabled();
});

test('an owner can revoke a missing meeting’s team grant from document sharing', async ({
  page,
}) => {
  await page.goto('/?document=1');
  const links = page.getByRole('region', { name: 'Meeting links' });
  await expect(links).toContainText('Unavailable meeting');
  await expect(links).toContainText('Macro');
  await links.getByRole('button', { name: 'Unlink', exact: true }).click();
  await links.getByRole('button', { name: 'Keep link' }).click();
  await expect(links).toBeVisible();
  await links.getByRole('button', { name: 'Unlink', exact: true }).click();
  await links
    .getByRole('button', { name: 'Unlink meeting', exact: true })
    .click();
  await expect(links).not.toBeVisible();
  await expect(page.getByText('Your document is saved.')).toBeVisible();
});

test('link a note, optionally share with a team, open it, and unlink it', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Link existing', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: /Link meeting notes|Note access|Unlink meeting notes/,
  });
  await expect(
    dialog.getByRole('button', { name: 'Link note', exact: true })
  ).toBeDisabled();
  await dialog
    .getByRole('textbox', { name: 'Find a markdown document' })
    .fill('weekly');
  await dialog
    .getByRole('button', { name: 'Weekly product sync', exact: true })
    .click();
  await expect(
    dialog.getByRole('checkbox', { name: /Also share with Macro/ })
  ).not.toBeChecked();
  await expect(
    dialog.getByRole('button', { name: 'Link note', exact: true })
  ).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('link-note.png') });
  await dialog.getByRole('button', { name: 'Link note', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole('button', { name: 'Options for Weekly product sync' })
    .click();
  await page.getByRole('menuitem', { name: 'Manage access' }).click();
  await dialog.getByText('Also share with Macro').click();
  await dialog.getByRole('button', { name: 'Save access' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Meeting notes' })
  ).toContainText('Also shared with Macro');
  await page.screenshot({ path: testInfo.outputPath('linked-note.png') });
  await page
    .getByRole('region', { name: 'Meeting notes' })
    .getByRole('button', { name: 'Open Weekly product sync', exact: true })
    .click();
  await expect(page.getByRole('status', { name: 'Preview action' })).toHaveText(
    'Opened Weekly product sync'
  );
  await page
    .getByRole('button', { name: 'Weekly product sync', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Options for Weekly product sync' })
    .click();
  await page.getByRole('menuitem', { name: 'Unlink from meeting' }).click();
  await dialog
    .getByRole('button', { name: 'Unlink note', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Link existing', exact: true })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Link existing', exact: true })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Weekly product sync', exact: true })
  ).toBeEnabled();
});

test('a failed link preserves the selected document and sharing choice for retry', async ({
  page,
}) => {
  await page.goto('/?fail=1');
  await page
    .getByRole('button', { name: 'Link existing', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: /Link meeting notes|Note access|Unlink meeting notes/,
  });
  await dialog
    .getByRole('button', { name: 'Weekly product sync', exact: true })
    .click();
  await dialog.getByText('Also share with Macro').click();
  await dialog.getByRole('button', { name: 'Link note', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Weekly product sync', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    dialog.getByRole('checkbox', { name: /Also share with Macro/ })
  ).toBeChecked();
  await dialog.getByRole('button', { name: 'Link note', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Meeting notes' })
  ).toContainText('Also shared with Macro');
});

test('removing a note during an open options menu does not block event dismissal', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Link existing', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Link meeting notes' });
  await dialog
    .getByRole('button', { name: 'Weekly product sync', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Link note', exact: true }).click();
  await page
    .getByRole('button', { name: 'Options for Weekly product sync' })
    .click();
  await expect(
    page.getByRole('menuitem', { name: 'Manage access' })
  ).toBeVisible();
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent('calendar-preview-unlink', { detail: 'weekly' })
    )
  );
  await expect(
    page.getByRole('menuitem', { name: 'Manage access' })
  ).not.toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('region', { name: 'Meeting notes' })
  ).not.toBeVisible();
  await page
    .getByRole('button', { name: 'Weekly product sync', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Meeting notes' })
  ).toBeVisible();
});

test('short dialogs scroll only the note results and keep context, sharing, and actions visible', async ({
  page,
}) => {
  await page.setViewportSize({
    width: page.viewportSize()?.width ?? 400,
    height: 520,
  });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Link existing', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Link meeting notes' });
  const title = dialog.getByRole('heading', { name: 'Link meeting notes' });
  const sharing = dialog.getByRole('region', { name: 'Note sharing' });
  const submit = dialog.getByRole('button', { name: 'Link note', exact: true });
  const results = dialog.getByRole('region', {
    name: 'Your markdown documents',
  });
  await expect(sharing).toBeInViewport({ ratio: 1 });
  await expect(submit).toBeInViewport({ ratio: 1 });
  await dialog.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished)
    );
  });
  const titleBefore = await title.boundingBox();
  const sharingBefore = await sharing.boundingBox();
  await results
    .getByRole('button', { name: 'Team retrospective', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(title).toBeInViewport({ ratio: 1 });
  await expect(
    dialog.getByText('Weekly product sync', { exact: true }).first()
  ).toBeInViewport({ ratio: 1 });
  expect(await title.boundingBox()).toEqual(titleBefore);
  expect(await sharing.boundingBox()).toEqual(sharingBefore);
  await results
    .getByRole('button', { name: 'Team retrospective', exact: true })
    .click();
  await submit.click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open Team retrospective', exact: true })
  ).toBeVisible();
});

test('search, dismiss, and reopen reset the unfinished choice', async ({
  page,
}) => {
  await page.goto('/?theme=dark');
  const trigger = page.getByRole('button', {
    name: 'Link existing',
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole('dialog', {
    name: /Link meeting notes|Note access|Unlink meeting notes/,
  });
  await dialog.getByRole('textbox').fill('no matching note');
  await expect(dialog.getByText('No notes match this name.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).not.toBeVisible();
  await trigger.click();
  await expect(dialog.getByRole('textbox')).toHaveValue('');
  await expect(
    dialog.getByRole('button', { name: 'Link note', exact: true })
  ).toBeDisabled();
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await expect(page.locator('body')).toHaveJSProperty(
    'scrollWidth',
    await page.locator('body').evaluate((body) => body.clientWidth)
  );
});

test('team selection and failure recovery stay visible in a short viewport', async ({
  page,
}) => {
  await page.setViewportSize({
    width: page.viewportSize()?.width ?? 400,
    height: 520,
  });
  await page.goto('/?hidden=1&fail=1');
  await page
    .getByRole('button', { name: 'Link existing', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Link meeting notes' });
  await expect(
    dialog.getByText(/This meeting hides its guest list/)
  ).toBeInViewport({ ratio: 1 });
  await dialog
    .getByRole('button', { name: 'Weekly product sync', exact: true })
    .click();
  await dialog.getByText('Also share with Macro').click();
  const submit = dialog.getByRole('button', { name: 'Link note', exact: true });
  await expect(submit).toBeInViewport({ ratio: 1 });
  await submit.click();
  await expect(dialog.getByRole('alert')).toBeInViewport({ ratio: 1 });
  await expect(
    dialog.getByRole('region', { name: 'Note sharing' })
  ).toBeInViewport({ ratio: 1 });
  await expect(submit).toBeInViewport({ ratio: 1 });
  await submit.click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Meeting notes' })
  ).toContainText('Also shared with Macro');
});
