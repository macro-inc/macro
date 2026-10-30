import { expect, test } from '@playwright/test';

test('reply defaults to its alias and selections retain the owning inbox', async ({
  page,
}) => {
  await page.goto('/?senders');
  await expect(page.getByTestId('sender')).toHaveText(
    'owned:resident@example.com'
  );
  const from = page.getByRole('button', { name: 'From address' });
  await from.click();
  await expect(page.getByRole('menuitem')).toHaveCount(4);
  await page
    .getByRole('menuitem', {
      name: 'Resident team <resident@example.com>',
      exact: true,
    })
    .nth(1)
    .click();
  await expect(page.getByTestId('sender')).toHaveText(
    'delegated:resident@example.com'
  );
  await from.press('Enter');
  await page
    .getByRole('menuitem', { name: 'base@example.com', exact: true })
    .press('Enter');
  await expect(page.getByTestId('sender')).toHaveText('owned:base@example.com');
});

test.describe('touch inbox list', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test('an unavailable saved alias does not select the sole primary inbox and can still be cleared', async ({
    page,
  }) => {
    await page.goto('/?senders');
    const sidebar = page.getByRole('navigation', { name: 'Inboxes' });
    await sidebar
      .getByRole('button', {
        name: 'resident@example.com Alias of base@example.com',
        exact: true,
      })
      .click();
    await page
      .getByRole('button', { name: 'Simulate unavailable aliases' })
      .click();
    await expect(page.getByTestId('alias-filter')).toContainText(
      'resident@example.com'
    );
    await expect(
      sidebar.getByRole('button', { name: 'base@example.com', exact: true })
    ).not.toHaveAttribute('aria-current', 'true');
    await sidebar.getByRole('button', { name: 'All inboxes' }).click();
    await expect(page.getByTestId('alias-filter')).toHaveText('{}');
    await expect(
      sidebar.getByRole('button', { name: 'base@example.com', exact: true })
    ).toHaveAttribute('aria-current', 'true');
  });

  test('sidebar aliases select independently and All clears both filters', async ({
    page,
  }) => {
    await page.goto('/?senders');
    const sidebar = page.getByRole('navigation', { name: 'Inboxes' });
    const ownedAlias = sidebar.getByRole('button', {
      name: 'resident@example.com Alias of base@example.com',
      exact: true,
    });
    const delegatedAlias = sidebar.getByRole('button', {
      name: 'resident@example.com Alias of manager@example.com',
      exact: true,
    });
    await ownedAlias.click();
    await expect(page.getByTestId('alias-filter')).toContainText(
      '"inboxId":"owned"'
    );
    await expect(ownedAlias).toHaveAttribute('aria-current', 'true');
    await delegatedAlias.click();
    await expect(page.getByTestId('alias-filter')).toContainText(
      '"inboxId":"delegated"'
    );
    await expect(delegatedAlias).toHaveAttribute('aria-current', 'true');
    await sidebar.getByRole('button', { name: 'All inboxes' }).click();
    await expect(page.getByTestId('alias-filter')).toHaveText('{}');
  });

  test('an alias does not make one inbox count as several', async ({
    page,
  }) => {
    await page.goto('/?senders');
    await page
      .getByRole('button', { name: 'Simulate one inbox with an alias' })
      .click();
    const sidebar = page.getByRole('navigation', { name: 'Inboxes' });
    const inbox = sidebar.getByRole('button', {
      name: 'base@example.com',
      exact: true,
    });
    const alias = sidebar.getByRole('button', {
      name: 'resident@example.com Alias of base@example.com',
      exact: true,
    });
    await expect(alias).toBeVisible();
    await expect(
      sidebar.getByRole('button', { name: 'All inboxes' })
    ).toHaveCount(0);
    await expect(inbox).toHaveAttribute('aria-current', 'true');

    await alias.click();
    await expect(page.getByTestId('alias-filter')).toContainText(
      '"emailAddress":"resident@example.com"'
    );
    await expect(alias).toHaveAttribute('aria-current', 'true');
    await expect(inbox).not.toHaveAttribute('aria-current', 'true');

    await inbox.click();
    await expect(page.getByTestId('alias-filter')).toHaveText(
      '{"inboxIds":["owned"]}'
    );
    await expect(inbox).toHaveAttribute('aria-current', 'true');
  });
});
