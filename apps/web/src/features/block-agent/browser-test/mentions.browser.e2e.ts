import { expect, test } from '@playwright/test';

test.setTimeout(60_000);

test('stopping and reloading a reply keeps complete chips and hides partial XML', async ({
  page,
}) => {
  await page.goto('/mentions.html');
  const reply = page.getByRole('region', { name: 'Agent reply' });
  await expect(reply).toContainText('Project notes', { timeout: 30_000 });
  await expect(reply.locator('[data-agent-session-mention]')).toHaveAttribute(
    'data-agent-session-label',
    'Project notes'
  );
  await expect(reply).toContainText('The next reference is');
  await expect(reply).not.toContainText('unfinished');

  await page.getByRole('button', { name: 'Stop response' }).click();
  await expect(
    page.getByRole('button', { name: 'Stopped', exact: true })
  ).toBeVisible();
  await expect(reply.locator('[data-agent-session-mention]')).toHaveAttribute(
    'data-agent-session-label',
    'Project notes'
  );
  await expect(reply).not.toContainText('unfinished');
  await expect(reply).not.toContainText('<m-');

  await page.reload();
  await expect(reply).toContainText('Project notes');
  await expect(reply.locator('[data-agent-session-mention]')).toHaveAttribute(
    'data-agent-session-label',
    'Project notes'
  );
  await expect(reply).toContainText('The next reference is');
  await expect(reply).not.toContainText('unfinished');
  await expect(reply).not.toContainText('<m-');
});

test('literal mention examples stay code when stopped and reloaded', async ({
  page,
}) => {
  await page.goto('/mentions.html?literal');
  const reply = page.getByRole('region', { name: 'Agent reply' });
  await expect(reply.locator('.md-inline-code')).toHaveText(
    '<m-document-mention>',
    {
      timeout: 30_000,
    }
  );
  await expect(reply).toContainText('as the tag name.');

  await page.getByRole('button', { name: 'Stop response' }).click();
  await expect(reply.locator('.md-inline-code')).toHaveText(
    '<m-document-mention>'
  );
  await expect(reply).toContainText('as the tag name.');

  await page.reload();
  await expect(reply.locator('.md-inline-code')).toHaveText(
    '<m-document-mention>'
  );
  await expect(reply).toContainText('as the tag name.');
});
