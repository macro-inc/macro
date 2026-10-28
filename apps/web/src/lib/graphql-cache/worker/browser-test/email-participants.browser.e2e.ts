import { expect, test } from '@playwright/test';

test('GitHub sender names survive loading another thread with the same address', async ({
  page,
}) => {
  await page.goto('email-participants.html');
  const result = page.locator('#result');
  await expect(result).toHaveAttribute('data-status', 'ready', {
    timeout: 60_000,
  });
  await page
    .getByRole('button', { name: 'Load another GitHub thread' })
    .click();
  await expect(result).toHaveAttribute('data-status', 'passed');
  const cached = JSON.parse((await result.textContent())!);
  expect(
    cached.user.soup.items[0].participants.map(
      (participant: { name: string }) => participant.name
    )
  ).toEqual(['Sean Aye', 'coderabbitai[bot]', 'cursor[bot]']);
});
