import { expect, test } from '@playwright/test';

const fixture = '/src/components/view-shell/browser-test/sidebar-title.html';

test('keeps the Chat sidebar title whole at a typical rail width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(fixture, { waitUntil: 'networkidle' });
  if (pageErrors.length) {
    throw new Error(pageErrors.join('\n'));
  }
  const trigger = page.getByRole('button', { name: 'Chat' });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText(/Chat/);
  const box = await trigger.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.width).toBeGreaterThan(48);
  const overflow = await trigger.evaluate((el) => {
    const label = el.querySelector('span');
    return label ? label.scrollWidth - label.clientWidth : 0;
  });
  expect(overflow).toBeLessThanOrEqual(1);
});

for (const width of [280, 200]) {
  test(`keeps a saved-view icon and title on one line in a ${width}px rail`, async ({
    page,
  }) => {
    const title = 'Follow-up tasks';
    await page.goto(
      `${fixture}?saved&title=${encodeURIComponent(title)}&width=${width}`
    );
    const trigger = page.getByRole('button', { name: title, exact: true });
    await expect(trigger).toBeVisible();
    const icon = await trigger.locator('svg').first().boundingBox();
    const label = await trigger.locator('span').last().boundingBox();
    expect(icon).toBeTruthy();
    expect(label).toBeTruthy();
    expect(icon!.width).toBeCloseTo(16, 0);
    expect(
      Math.abs(icon!.y + icon!.height / 2 - label!.y - label!.height / 2)
    ).toBeLessThan(1);
    expect(icon!.x + icon!.width).toBeLessThanOrEqual(label!.x);
    const box = await trigger.boundingBox();
    expect(box!.height).toBeLessThanOrEqual(28);
    if (width === 280) {
      expect(
        await trigger
          .locator('span')
          .last()
          .evaluate((el) => el.scrollWidth - el.clientWidth)
      ).toBeLessThanOrEqual(1);
    }
    await trigger.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: 'Tasks', exact: true })
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}

test('keeps long text titles bounded without shrinking the caret', async ({
  page,
}) => {
  const title = 'Tasks assigned to me and awaiting follow-up';
  await page.goto(`${fixture}?title=${encodeURIComponent(title)}&width=200`);
  const trigger = page.getByRole('button', { name: title, exact: true });
  await expect(trigger).toBeVisible();
  const caret = await trigger.locator('svg').boundingBox();
  expect(caret!.width).toBeCloseTo(12, 0);
  const bounds = await trigger.evaluate((el) => ({
    right: el.getBoundingClientRect().right,
    headerRight: el
      .closest('[data-view-sidebar-header]')!
      .getBoundingClientRect().right,
    overflow: el.scrollWidth - el.clientWidth,
  }));
  expect(bounds.right).toBeLessThan(bounds.headerRight);
  expect(bounds.overflow).toBeLessThanOrEqual(1);
});

for (const saved of [false, true]) {
  test(`keeps the ${saved ? 'saved' : 'built-in'} list title whole beside scrolling controls`, async ({
    page,
  }) => {
    const title = saved ? 'Follow-up tasks' : 'My tasks';
    await page.goto(
      `${fixture}?list&${saved ? 'saved&' : ''}title=${encodeURIComponent(title)}&width=480`
    );
    const trigger = page.getByRole('button', { name: title, exact: true });
    await expect(trigger).toBeVisible();
    const label = trigger.locator('span').last();
    expect(
      await label.evaluate((el) => el.scrollWidth - el.clientWidth)
    ).toBeLessThanOrEqual(1);
    const bounds = await trigger.evaluate((el) => ({
      left: el.getBoundingClientRect().left,
      clipLeft: el
        .closest('nav')!
        .parentElement!.parentElement!.getBoundingClientRect().left,
      right: el.getBoundingClientRect().right,
      headerRight: el
        .closest('[data-view-shell-top-bar]')!
        .getBoundingClientRect().right,
    }));
    expect(bounds.left).toBeGreaterThanOrEqual(bounds.clipLeft);
    expect(bounds.right).toBeLessThan(bounds.headerRight);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    expect(
      await label.evaluate((el) => el.scrollWidth - el.clientWidth)
    ).toBeLessThanOrEqual(1);
  });
}
