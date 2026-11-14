import { expect, type Page, test } from '@playwright/test';
import { serveFromNode } from '../../calendar/browser-test/serve-from-node';

async function openDetails(page: Page, query: string) {
  await serveFromNode(page);
  await page.goto(`/?${query}`);
  await page
    .getByRole('button', { name: 'Planning review', exact: true })
    .click();
  const details = page.getByRole('dialog', { name: 'Planning review' });
  await expect(details).toBeVisible();
  return details;
}

test.describe('event details for someone who cannot change the event', () => {
  // Class cal-guest-permissions: when this fails, the copy of a shared
  // meeting offers Edit, which opens a composer whose changes are refused.
  test('a snapshot copy of a shared meeting offers no Edit', async ({
    page,
  }) => {
    const organized = await openDetails(page, '');
    await expect(
      organized.getByRole('button', { name: 'Edit event' })
    ).toBeVisible();

    const snapshot = await openDetails(page, 'viewer=snapshot');
    await expect(
      snapshot.getByRole('button', { name: 'Email guests' })
    ).toBeVisible();
    await expect(
      snapshot.getByRole('button', { name: 'Edit event' })
    ).toHaveCount(0);
  });

  // Class cal-guest-permissions: when this fails, a guest whose organizer
  // hides the guest list sees a count of the few guests their copy holds and
  // can copy that partial list as if it were everyone.
  test('a hidden guest list is named as hidden and cannot be copied', async ({
    page,
  }) => {
    const details = await openDetails(page, 'viewer=hidden-guests');

    await expect(details.getByText('Guest list hidden')).toBeVisible();
    await expect(details.getByText(/\d+ attendees?/)).toHaveCount(0);
    await expect(
      details.getByRole('button', { name: 'Email guests' })
    ).toBeVisible();
    await expect(
      details.getByRole('button', { name: 'Copy guest emails' })
    ).toHaveCount(0);
  });
});

test.describe('links in an event description', () => {
  // Class web-cal-deep-links: when this fails, a web address typed into an
  // event's description shows as plain text that cannot be opened.
  test('a bare web address in the description is a link to it', async ({
    page,
  }) => {
    const details = await openDetails(page, 'description=address');

    await expect(details.getByText('Read the agenda at')).toBeVisible();
    await expect(
      details.getByRole('link', { name: 'https://example.com/agenda' })
    ).toHaveAttribute('href', 'https://example.com/agenda');
  });
});
