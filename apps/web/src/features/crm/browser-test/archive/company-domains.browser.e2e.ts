import { expect, type Locator, type Page, test } from '@playwright/test';

// Production controls and mutation with synthetic transport responses;
// these checks do not establish hosted persistence.

const THREE =
  'example.com,example.org,a-much-longer-subsidiary-name.example.org';

/** Whether a row action has room on screen; hidden ones are 0 wide. */
const shown = (action: Locator) =>
  action.evaluate(
    (element) => (element.parentElement?.getBoundingClientRect().width ?? 0) > 0
  );

const header = (page: Page) =>
  page.getByLabel('Company details', { exact: true });

async function openDetails(page: Page) {
  await page.getByRole('button', { name: 'Show details', exact: true }).click();
  const field = page.getByRole('group', { name: 'Domains', exact: true });
  await expect(field).toBeVisible();
  return field;
}

async function snapshot(page: Page) {
  return page.evaluate(() =>
    window.archiveFixture.snapshot().company.domains.map((d) => d.domain)
  );
}

test('a company header shows its domains as one pill, with every domain on hover', async ({
  page,
  isMobile,
}, info) => {
  await page.goto(`/?kind=company&domains=${THREE}`);
  const pill = header(page).getByRole('button', {
    name: 'Domain: example.com and 2 more',
    exact: true,
  });
  await expect(pill).toBeVisible();
  await expect(pill).toContainText('+2');
  await expect(
    header(page).getByText('example.org', { exact: true })
  ).toBeHidden();
  await expect(
    header(page).getByRole('button', { name: 'Add domain', exact: true })
  ).toHaveCount(0);
  if (!isMobile) {
    await pill.hover();
    await expect(
      page.getByText('Domains', { exact: true }).last()
    ).toBeVisible();
    for (const domain of THREE.split(','))
      await expect(
        page.getByText(domain, { exact: true }).last()
      ).toBeVisible();
  }
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('header-three.png'),
  });
});

test('a company with no domain shows the empty Domain pill and only Add domain', async ({
  page,
}) => {
  await page.goto('/?kind=company&domains=');
  await expect(
    header(page).getByRole('button', { name: 'Add domain', exact: true })
  ).toContainText('Domain');
  const field = await openDetails(page);
  await expect(
    field.getByRole('button', { name: /^Domain options for/ })
  ).toHaveCount(0);
  await expect(
    field.getByRole('button', { name: 'Add domain', exact: true })
  ).toBeVisible();
});

test('Record details lists each domain on its own line, Remove on hover or focus on desktop and always on touch', async ({
  page,
  isMobile,
}, info) => {
  await page.goto(`/?kind=company&domains=${THREE}`);
  const field = await openDetails(page);
  const domains = field.getByRole('button', { name: /^Domain options for/ });
  await expect(domains).toHaveText(THREE.split(','));
  // The primary is the first, and every domain offers Remove.
  const rows = field.locator('.group\\/value');
  await expect(rows.first()).toContainText('Primary');
  await expect(rows.nth(1)).not.toContainText('Primary');
  await expect(field.getByRole('button', { name: /^Remove / })).toHaveCount(3);
  await expect(field.getByRole('button', { name: /primary$/ })).toHaveCount(0);
  const remove = field.getByRole('button', { name: 'Remove example.org' });

  // The label sits on the first line; Add domain is under the last.
  const box = await field.evaluate((group) => {
    const rect = (element: Element) => element.getBoundingClientRect();
    const label = group.parentElement!.previousElementSibling!;
    const inset = Number.parseFloat(getComputedStyle(label).paddingTop);
    const values = [...group.querySelectorAll('.group\\/value')];
    const first = rect(values[0]!);
    const last = rect(values.at(-1)!);
    const add = rect(group.querySelector('button[aria-label="Add domain"]')!);
    const l = rect(label);
    return {
      label: label.textContent,
      labelMiddle: l.y + inset + (l.height - inset) / 2,
      firstMiddle: first.y + first.height / 2,
      firstX: first.x,
      lastBottom: last.y + last.height,
      addX: add.x,
      addY: add.y,
    };
  });
  expect(box.label).toBe('Website');
  expect(Math.abs(box.labelMiddle - box.firstMiddle)).toBeLessThanOrEqual(2);
  expect(box.addY).toBeGreaterThan(box.lastBottom - 1);
  expect(Math.abs(box.addX - box.firstX)).toBeLessThanOrEqual(2);

  if (isMobile) {
    expect(await shown(remove)).toBe(true);
  } else {
    expect(await shown(remove)).toBe(false);
    await field
      .getByRole('button', { name: 'Domain options for example.org' })
      .hover();
    expect(await shown(remove)).toBe(true);
  }
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('details-three.png'),
  });
});

test('the editor adds a domain and stays open, shows refusals, and removes from its rows', async ({
  page,
  isMobile,
}, info) => {
  await page.goto('/?kind=company');
  await header(page)
    .getByRole('button', { name: 'Domain: example.com', exact: true })
    .click();
  const input = page.getByRole('textbox', { name: 'Domain', exact: true });
  await expect(input).toBeVisible();
  await expect(
    page.getByText('Mail and new contacts from this domain go to this company.')
  ).toBeVisible();
  const list = page.getByRole('list', { name: 'Domains' });

  await input.fill('Example.org');
  await input.press('Enter');
  await expect(list.getByText('example.org', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('');
  if (!isMobile) await expect(input).toBeFocused();
  expect(await snapshot(page)).toEqual(['example.com', 'example.org']);

  await input.fill('example.net');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toHaveText(
    'Second company already has this domain. Remove it there first.'
  );
  await expect(input).toHaveValue('example.net');
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('editor-taken.png'),
  });

  // On desktop a row's Remove shows while the row is hovered.
  const removeIn = async (domain: string) => {
    if (!isMobile) await list.getByText(domain, { exact: true }).hover();
    await list.getByRole('button', { name: `Remove ${domain}` }).click();
  };
  await removeIn('example.com');
  await expect(page.getByRole('alert')).toHaveText(
    'The company is named after this domain. Rename the company first.'
  );
  await removeIn('example.org');
  await expect(list.getByText('example.org', { exact: true })).toBeHidden();
  expect(await snapshot(page)).toEqual(['example.com']);
});

test('keyboard: domain rows and the editor return focus where the page left it', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop keyboard focus');
  await page.goto('/?kind=company&domains=example.com,example.org');
  const pill = header(page).getByRole('button', {
    name: 'Domain: example.com and 1 more',
  });
  await pill.focus();
  await page.keyboard.press('Enter');
  const input = page.getByRole('textbox', { name: 'Domain', exact: true });
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pill).toBeFocused();

  const field = await openDetails(page);
  const add = field.getByRole('button', { name: 'Add domain', exact: true });
  // Tab reaches Remove, which shows as it takes focus.
  await field
    .getByRole('button', { name: 'Domain options for example.org' })
    .focus();
  await page.keyboard.press('Tab');
  const remove = field.getByRole('button', { name: 'Remove example.org' });
  await expect(remove).toBeFocused();
  expect(await shown(remove)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(
    field.getByRole('button', { name: 'Domain options for example.org' })
  ).toHaveCount(0);
  await expect(add).toBeFocused();

  // The editor opened from a domain returns focus to it.
  const primary = field.getByRole('button', {
    name: 'Domain options for example.com',
  });
  await primary.focus();
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(primary).toBeFocused();
});
