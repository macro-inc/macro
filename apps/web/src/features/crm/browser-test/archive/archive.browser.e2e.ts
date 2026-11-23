import { expect, type Locator, type Page, test } from '@playwright/test';

async function archive(page: Page) {
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).not.toHaveAttribute('data-transitioning');
  return dialog;
}

/** Waits for finite motion; a looping skeleton pulse never finishes. */
function settle(page: Page) {
  return page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter(
          (motion) => motion.effect?.getComputedTiming().endTime !== Infinity
        )
        .map((motion) => motion.finished)
    )
  );
}

/** Opens the information panel and waits for it to stop moving. */
async function openDetails(page: Page, kind: string) {
  await page.goto(`/?kind=${kind}`);
  await page.getByRole('button', { name: 'Show details', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Record details' })
  ).toBeVisible();
  await settle(page);
}

/** Where a block's text starts, inside any padding of its own. */
function textStart(locator: Locator) {
  return locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().x;
  });
}
test.beforeEach(async ({ page }) => {
  await page.route('https://**', (route) => route.abort());
  await page.routeWebSocket('**', (socket) => socket.close());
});

test('archive, cancel, rejected save, retry and direct person restore', async ({
  page,
}, info) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Contact name' })).toHaveValue(
    'Example person'
  );
  await page.screenshot({ path: info.outputPath('visible.png') });
  const dialog = await archive(page);
  await expect(dialog).toContainText('record and its history are kept');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(0);
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Archive', exact: true })
  ).toBeFocused();
  await page.evaluate(() => window.archiveFixture.failNext());
  await archive(page);
  await dialog.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Could not save');
  expect(
    await page.evaluate(
      () => window.archiveFixture.snapshot().contacts[0].hidden
    )
  ).toBe(false);
  await dialog.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Archived — details' })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Archive', exact: true })
  ).toHaveCount(0);
  const restore = page.getByRole('button', { name: 'Restore', exact: true });
  await expect(restore).toBeVisible();
  await page.screenshot({ path: info.outputPath('archived.png') });
  await restore.click();
  await expect(
    page.getByRole('button', { name: 'Archive', exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => window.archiveFixture.snapshot().contacts[0].hidden
    )
  ).toBe(false);
});

test('pending prevents duplicates and company restore confirms the full cascade', async ({
  page,
}, info) => {
  await page.goto('/?kind=company');
  const dialog = await archive(page);
  await expect(dialog).toContainText('All of its people will also be archived');
  await page.evaluate(() => window.archiveFixture.holdNext());
  await dialog.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Archive', exact: true })
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(1);
  await page.evaluate(() => window.archiveFixture.release());
  await expect(
    page.getByRole('button', { name: 'Restore', exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => window.archiveFixture.snapshot().company.emailSync
    )
  ).toBe(false);
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(dialog).toContainText('including people archived individually');
  await expect(dialog).toContainText('Email syncing will stay off');
  await expect(dialog).not.toHaveAttribute('data-transitioning');
  await expect(
    dialog.getByRole('button', { name: 'Restore', exact: true })
  ).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: info.outputPath('company-restore-confirmation.png'),
  });
  await dialog.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Archive', exact: true })
  ).toBeVisible();
  const saved = await page.evaluate(() => window.archiveFixture.snapshot());
  expect(saved.company.emailSync).toBe(false);
  expect(saved.contacts.map((contact) => contact.hidden)).toEqual([
    false,
    false,
  ]);
});

test('chip explanation has its own keyboard and touch lifecycle with narrow layout', async ({
  page,
  isMobile,
}, info) => {
  await page.goto('/?archived');
  const chip = page.getByRole('button', { name: 'Archived — details' });
  const restore = page.getByRole('button', { name: 'Restore', exact: true });
  if (isMobile) {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(restore).toBeInViewport({ ratio: 1 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      await page.screenshot({ path: info.outputPath(`archived-${width}.png`) });
    }
    await chip.click();
    await expect(page.getByRole('dialog')).toContainText(
      'Excluded from visible People'
    );
    await expect(page.getByRole('dialog')).not.toHaveAttribute(
      'data-transitioning'
    );
  } else {
    await chip.focus();
    await expect(page.getByRole('tooltip')).toContainText(
      'Excluded from visible People'
    );
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole(isMobile ? 'dialog' : 'tooltip')).toHaveCount(0);
  await restore.focus();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.evaluate(() => window.archiveFixture.setRole('member'));
  await expect(restore).toBeDisabled();
});

test('compact record controls keep separate full-height touch targets', async ({
  page,
  isMobile,
}) => {
  for (const width of isMobile ? [390, 320, 820] : [1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const kind of ['contact', 'company']) {
      const companyName = width === 320 ? 'I' : 'Example company';
      await page.goto(
        `/?kind=${kind}&archived&companyName=${encodeURIComponent(companyName)}${kind === 'company' ? '&companyArchived' : ''}`
      );
      const chip = page.getByRole('button', { name: 'Archived — details' });
      const restore = page.getByRole('button', {
        name: 'Restore',
        exact: true,
      });
      await expect(restore).toBeVisible();
      const controls = [chip, restore];
      // The company pill's name opens the company.
      const companyNavigation = page.getByRole('button', {
        name: `Open ${companyName}`,
        exact: true,
      });
      if (kind === 'contact') controls.push(companyNavigation);

      for (const control of controls) {
        const bounds = (await control.boundingBox())!;
        await expect(control).toHaveCSS('font-size', '12px');
        // The company pill is a button group, whose segments take its own
        // 36px touch height; the other controls keep a 24px face.
        if (isMobile && control === companyNavigation) {
          expect(bounds.height).toBeGreaterThanOrEqual(36);
          expect(bounds.width).toBeGreaterThanOrEqual(44);
          continue;
        }
        expect(bounds.height).toBe(24);
        if (!isMobile) continue;
        expect(bounds.width).toBeGreaterThanOrEqual(44);
        // The visible face is compact; the reserved margin and transparent
        // extension must still deliver taps across a separate 44px target.
        for (const y of [bounds.y - 9.5, bounds.y + bounds.height + 9.5]) {
          expect(
            await control.evaluate(
              (element, point) =>
                document
                  .elementFromPoint(point.x, point.y)
                  ?.closest('button') === element,
              { x: bounds.x + bounds.width / 2, y }
            )
          ).toBe(true);
        }
      }
      const chipBounds = (await chip.boundingBox())!;
      const restoreBounds = (await restore.boundingBox())!;
      expect(chipBounds.y).toBe(restoreBounds.y);
      expect(chipBounds.x + chipBounds.width).toBeLessThan(restoreBounds.x);

      if (isMobile) {
        await page.touchscreen.tap(
          chipBounds.x + chipBounds.width / 2,
          chipBounds.y - 9
        );
        await expect(page.getByRole('dialog')).toContainText('Excluded from');
        expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(
          0
        );
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.touchscreen.tap(
          restoreBounds.x + restoreBounds.width / 2,
          restoreBounds.y + restoreBounds.height + 9
        );
      } else {
        await restore.focus();
        await expect(restore).toBeFocused();
        await page.keyboard.press('Enter');
      }
      if (kind === 'company') {
        const dialog = page.getByRole('dialog');
        await expect(dialog).toContainText(
          'including people archived individually'
        );
        await expect(dialog).not.toHaveAttribute('data-transitioning');
        await dialog
          .getByRole('button', { name: 'Cancel', exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
        await expect(restore).toBeFocused();
      } else {
        await expect(
          page.getByRole('button', { name: 'Archive', exact: true })
        ).toBeVisible();
        const company = companyNavigation;
        const bounds = (await company.boundingBox())!;
        // The company pill's segments take its full 36px touch height, with
        // no extension beyond it.
        if (isMobile)
          await page.touchscreen.tap(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2
          );
        else await company.click();
        await expect(
          page.getByRole('textbox', { name: 'Company name' })
        ).toBeVisible();
      }
    }
  }
});

test('restoring a person whose company is archived routes to company confirmation', async ({
  page,
}) => {
  await page.goto('/?companyArchived&legacyParent');
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Restore the company first');
  expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(0);
  await dialog.getByRole('button', { name: 'Open company' }).click();
  await expect(
    page.getByRole('textbox', { name: 'Company name' })
  ).toBeVisible();
});

test('Team Visible and Archived are exclusive and preserve scoped search', async ({
  page,
}, info) => {
  await page.goto('/?kind=company&team');
  await expect(
    page.getByRole('button', { name: /Example person/ })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Second person/ })).toHaveCount(
    0
  );
  const search = page.getByRole('searchbox');
  await search.fill('person');
  const filter = page.getByRole('button', { name: 'Visibility' });
  await filter.click();
  await expect(
    page.getByRole('menuitemradio', { name: 'Visible', exact: true })
  ).toHaveAttribute('aria-checked', 'true');
  await page
    .getByRole('menuitemradio', { name: 'Archived', exact: true })
    .click();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: /Second person/ })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Example person/ })
  ).toHaveCount(0);
  await expect(search).toHaveValue('person');
  await page.screenshot({ path: info.outputPath('team-archived.png') });
  await page.evaluate(() => window.archiveFixture.setRole('member'));
  await expect(filter).toContainText('Visible');
  await page.goto('/?kind=company&team&companyArchived&legacyParent');
  await expect(
    page.getByRole('heading', { name: 'No contacts yet' })
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Add contact',
      exact: true,
      disabled: false,
    })
  ).toHaveCount(0);
  await filter.click();
  await page
    .getByRole('menuitemradio', { name: 'Archived', exact: true })
    .click();
  await page.keyboard.press('Escape');
  await expect(
    page
      .getByRole('button', { name: /Example person/ })
      .getByText('Archived', { exact: true })
  ).toBeVisible();
});

test('Details lists record details, properties, company sections, then references', async ({
  page,
}) => {
  for (const kind of ['contact', 'company']) {
    await openDetails(page, kind);
    const titles = [
      'Record details',
      'Properties',
      ...(kind === 'company' ? ['Email sharing'] : []),
      'References',
    ];
    const tops: number[] = [];
    for (const title of titles) {
      const heading = page.getByRole('button', { name: title, exact: true });
      await expect(heading).toBeVisible();
      tops.push((await heading.boundingBox())!.y);
    }
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
  }
});

test('Details rows and the references empty state use the panel type scale', async ({
  page,
}) => {
  const style = (locator: Locator) =>
    locator.evaluate((element) => {
      const computed = getComputedStyle(element);
      return { fontSize: computed.fontSize, color: computed.color };
    });
  for (const kind of ['contact', 'company']) {
    await openDetails(page, kind);
    const details = page.getByRole('region', { name: 'Record details' });
    const properties = page.getByRole('region', { name: 'Properties' });
    const propertyLabel = properties.getByText('Phone', { exact: true });
    const propertyValue = properties.getByText('+1 555 0100', { exact: true });
    await expect(propertyLabel).toBeVisible();
    const labelStyle = await style(propertyLabel);
    const labelX = (await propertyLabel.boundingBox())!.x;
    expect(labelStyle.fontSize).toBe(
      (
        await style(
          page.getByRole('button', { name: 'Record details', exact: true })
        )
      ).fontSize
    );
    const labels =
      kind === 'company' ? ['Name', 'Website'] : ['Name', 'Email', 'Company'];
    for (const label of labels) {
      const cell = details.getByText(label, { exact: true });
      expect(await style(cell)).toEqual(labelStyle);
      expect(Math.abs((await cell.boundingBox())!.x - labelX)).toBeLessThan(2);
    }
    const name = details.getByText(
      kind === 'company' ? 'Example company' : 'Example person',
      { exact: true }
    );
    expect(await style(name)).toEqual(await style(propertyValue));
    const empty = page.getByText(`Nothing references this ${kind} yet.`, {
      exact: true,
    });
    const references = page.getByRole('button', {
      name: 'References',
      exact: true,
    });
    if ((await references.getAttribute('aria-expanded')) !== 'true')
      await references.click();
    await expect(empty).toBeVisible();
    await settle(page);
    expect(await style(empty)).toEqual(labelStyle);
    expect(
      Math.abs((await textStart(empty)) - (await textStart(propertyLabel)))
    ).toBeLessThan(2);
  }
});
