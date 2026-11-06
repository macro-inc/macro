import { expect, test } from '@playwright/test';

for (const access of ['read', 'resident', 'user', 'owner']) {
  test(`${access} opens watching and controls only where authorized`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/?access=${access}`);
    await expect(page.getByLabel('Discovery requests')).toHaveText('0');
    await page.getByRole('button', { name: 'Open agent computer' }).click();
    await expect(
      page.getByText('Simulated desktop · watch', { exact: true })
    ).toBeVisible();
    await expect(page.getByLabel('Discovery requests')).toHaveText('1');
    const host = await page.getByTestId('settings-screen-host').boundingBox();
    if (!host) throw new Error('The settings screen host is missing');
    await expect
      .poll(async () => {
        const viewer = await page
          .getByLabel('Computer screen', { exact: true })
          .boundingBox();
        return viewer?.width ?? 0;
      })
      .toBeCloseTo(host.width, 0);
    await expect
      .poll(async () => {
        const content = await page
          .locator('[data-resize-panel]')
          .first()
          .boundingBox();
        return content?.width ?? Infinity;
      })
      .toBeLessThanOrEqual(1);
    await expect(
      page.getByText('Settings content remains mounted')
    ).toBeAttached();
    const canControl =
      testInfo.project.name === 'desktop' &&
      (access === 'user' || access === 'owner');
    const control = page.getByRole('button', {
      name: 'Take control',
      exact: true,
    });
    if (canControl) {
      await control.click();
      await expect(
        page.getByText('Simulated desktop · control', { exact: true })
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Stop controlling', exact: true })
        .click();
      await expect(
        page.getByText('Simulated desktop · watch', { exact: true })
      ).toBeVisible();
      await expect(page.getByLabel('Transport history')).toHaveText(
        'watch,control,watch'
      );
    } else {
      await expect(control).toHaveCount(0);
      await expect(page.getByLabel('Transport history')).toHaveText('watch');
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    await page
      .getByRole('button', { name: 'Close screen', exact: true })
      .click();
    await expect(
      page.getByText('Settings content remains mounted')
    ).toBeVisible();
    await expect(
      page.getByLabel('Computer screen', { exact: true })
    ).toHaveCount(0);
  });
}

test('a runtime entry uses the same provider without an agent lookup', async ({
  page,
}) => {
  await page.goto('/?access=read&ordinary');
  await page.getByRole('button', { name: 'Open runtime computer' }).click();
  await expect(
    page.getByText('Simulated desktop · watch', { exact: true })
  ).toBeVisible();
  await expect(page.getByLabel('Discovery requests')).toHaveText('0');
});

test('an agent computer without access offers only View and submits that level', async ({
  page,
}) => {
  await page.goto('/?access=none');
  await page.getByRole('button', { name: 'Open agent computer' }).click();
  await page.getByRole('button', { name: 'Requested access level' }).click();
  await expect(
    page.getByRole('menuitem', { name: 'View', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: 'Edit', exact: true })
  ).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page
    .getByRole('button', { name: 'Request access', exact: true })
    .click();
  await expect(page.getByLabel('Submitted request levels')).toHaveText('view');
  await expect(
    page.getByRole('button', { name: 'Request sent', exact: true })
  ).toBeDisabled();
  await expect(page.getByLabel('Transport history')).toBeEmpty();
});

test('an ordinary runtime uses its server-supported View and Edit choices', async ({
  page,
}) => {
  await page.goto('/?access=none&ordinary');
  await page.getByRole('button', { name: 'Open runtime computer' }).click();
  await page.getByRole('button', { name: 'Requested access level' }).click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await page
    .getByRole('button', { name: 'Request access', exact: true })
    .click();
  await expect(page.getByLabel('Submitted request levels')).toHaveText('edit');
});

test('closing during discovery ignores a late result', async ({ page }) => {
  await page.goto('/?access=owner&slow-discovery');
  await page.getByRole('button', { name: 'Open agent computer' }).click();
  await expect(page.getByText('Loading computer access…')).toBeVisible();
  await page.getByRole('button', { name: 'Close screen', exact: true }).click();
  await page.getByRole('button', { name: 'Finish lookup' }).click();
  await expect(page.getByLabel('Computer screen', { exact: true })).toHaveCount(
    0
  );
  await expect(page.getByLabel('Transport history')).toBeEmpty();
});

for (const scenario of ['lookup-error', 'directory-error', 'unpaired']) {
  test(`${scenario} keeps a reachable error and close action`, async ({
    page,
  }) => {
    await page.goto(`/?access=owner&${scenario}`);
    await page.getByRole('button', { name: 'Open agent computer' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByLabel('Transport history')).toBeEmpty();
    await page
      .getByRole('button', { name: 'Close screen', exact: true })
      .click();
    await expect(
      page.getByText('Settings content remains mounted')
    ).toBeVisible();
  });
}

test('the disabled rollout leaves settings mounted without discovery or directory work', async ({
  page,
}) => {
  await page.goto('/?flag-off');
  await expect(
    page.getByText('Settings content remains mounted')
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open agent computer' })
  ).toBeDisabled();
  await expect(page.getByLabel('Directory requests')).toHaveText('0');
  await expect(page.getByLabel('Discovery requests')).toHaveText('0');
});

test('reopening retries directory access after its service recovers', async ({
  page,
}) => {
  await page.goto('/?access=owner&directory-error');
  await page.getByRole('button', { name: 'Open agent computer' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Close screen', exact: true }).click();
  await page.getByRole('button', { name: 'Restore directory service' }).click();
  await page.getByRole('button', { name: 'Open agent computer' }).click();
  await expect(
    page.getByText('Simulated desktop · watch', { exact: true })
  ).toBeVisible();
});

test('revoking desktop control disconnects input and returns to watching', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await page.goto('/?access=owner');
  await page.getByRole('button', { name: 'Open agent computer' }).click();
  await page.getByRole('button', { name: 'Take control', exact: true }).click();
  await expect(
    page.getByText('Simulated desktop · control', { exact: true })
  ).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new Event('fixture:revoke-control'))
  );
  await expect(
    page.getByText('Simulated desktop · watch', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Take control', exact: true })
  ).toHaveCount(0);
  await expect(page.getByLabel('Transport history')).toHaveText(
    'watch,control,watch'
  );
});
