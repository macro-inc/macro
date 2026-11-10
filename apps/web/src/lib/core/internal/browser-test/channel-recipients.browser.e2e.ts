import { expect, test } from '@playwright/test';

for (const surface of ['modal', 'panel']) {
  test(`${surface} invites retain selections across pages without suggesting existing members`, async ({
    page,
  }, info) => {
    await page.goto(`/?channel-recipients=${surface}`);
    await expect(page.getByTestId('requests')).toHaveText('0');
    await page.getByRole('button', { name: 'Open participant picker' }).click();
    const input = page.getByRole('combobox');
    await input.click();
    await expect(
      page.getByRole('option', { name: /person1@example\.com/ })
    ).toBeVisible();
    await expect(
      page.getByRole('option', { name: /person0@example\.com/ })
    ).toHaveCount(0);
    await expect(page.getByTestId('excluded')).toContainText(
      'macro|person0@example.com'
    );
    if (info.project.name === 'phone')
      await page.getByRole('button', { name: 'Next options' }).click();
    else await input.press('PageDown');
    await expect(
      page.getByRole('option', { name: /person51@example\.com/ })
    ).toBeVisible();
    await page.getByRole('option', { name: /person51@example\.com/ }).click();
    await input.fill('late');
    await expect(
      page.getByRole('option', { name: /Late person/ })
    ).toBeVisible();
    await input.press('Enter');
    await page
      .getByRole('button', {
        name: surface === 'modal' ? 'Add' : 'Add Participants',
        exact: true,
      })
      .click();
    await expect(page.getByTestId('added')).toHaveText(
      '["macro|person51@example.com","macro|person99999@example.com"]'
    );
  });

  test(`${surface} does not re-add someone who joins while selected`, async ({
    page,
  }) => {
    await page.goto(`/?channel-recipients=${surface}`);
    await page.getByRole('button', { name: 'Open participant picker' }).click();
    const input = page.getByRole('combobox');
    await input.fill('late');
    await expect(
      page.getByRole('option', { name: /Late person/ })
    ).toBeVisible();
    await input.press('Enter');
    const add = page.getByRole('button', {
      name: surface === 'modal' ? 'Add' : 'Add Participant',
      exact: true,
    });
    await expect(add).toBeEnabled();
    await page.evaluate(() =>
      window.dispatchEvent(new Event('fixture-member-joined'))
    );
    await expect(add).toBeDisabled();
    await expect(page.getByTestId('added')).toHaveText('[]');
    await expect(page.getByText('Late person', { exact: true })).toBeVisible();
  });
}

test('touch selection and paging keep the invitation drawer open', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone', 'Touch-only interaction');
  await page.goto('/?channel-recipients=modal');
  await page.getByRole('button', { name: 'Open participant picker' }).tap();
  const input = page.getByRole('combobox');
  // Kobalte reserves exact-center touchend for an assistive toggle.
  await input.tap({ position: { x: 10, y: 10 } });
  await expect(
    page.getByRole('option', { name: /person1@example\.com/ })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Next options' }).tap();
  await page.getByRole('option', { name: /person51@example\.com/ }).tap();
  await expect(input).toBeVisible();
  await page.getByRole('button', { name: 'Add', exact: true }).tap();
  await expect(page.getByTestId('added')).toHaveText(
    '["macro|person51@example.com"]'
  );
});

test('explicit external invitation addresses remain independent of directory results', async ({
  page,
}) => {
  await page.goto('/?channel-recipients=modal');
  await page.getByRole('button', { name: 'Open participant picker' }).click();
  const input = page.getByRole('combobox');
  await input.fill('outside@example.org');
  await expect(
    page.getByRole('option', { name: /outside@example.org/ })
  ).toBeVisible();
  await input.press('Enter');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('added')).toHaveText(
    '["macro|outside@example.org"]'
  );
});

test('whole-team invitations do not depend on the personal suggestion window', async ({
  page,
}) => {
  await page.goto('/?channel-recipients=modal');
  await page.getByRole('button', { name: 'Open participant picker' }).click();
  await page
    .getByText('Add all members of Example team', { exact: true })
    .click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('added')).toHaveText(
    '["macro|teammate@example.com"]'
  );
});
