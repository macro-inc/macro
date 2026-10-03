import { expect, test } from '@playwright/test';

const path = '/src/features/email-marketing/browser-test/marketing.html';
test('v1 creates a campaign, previews, enrolls, cross-references CRM, pauses, resumes, and stops', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(path);
  await expect(
    page.getByRole('heading', { name: 'Campaigns', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: '＋ New campaign' }).click();
  await page.getByLabel('New campaign name').fill('A warm welcome');
  await page
    .getByRole('button', { name: 'Create campaign', exact: true })
    .click();
  await page
    .getByLabel('Email 1 subject')
    .fill('Welcome to Macro, {{firstName}}');
  await page
    .getByLabel('Email 1 message')
    .fill(
      'Hi {{firstName}},\n\nWelcome to Macro. Your team’s work finally has a home.\n\nHit reply if you need a hand getting started.'
    );
  await page.getByRole('button', { name: '＋ Add email' }).click();
  await page.getByLabel('Email 3 subject').fill('Anything we can help with?');
  await page
    .getByLabel('Email 3 message')
    .fill(
      'Hi {{firstName}},\n\nHow is your first week going? Let me know if we can help.'
    );
  await page.getByLabel('Email 3 delay days').fill('3');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Campaign saved');
  await page
    .getByRole('button', { name: 'Preview', exact: true })
    .first()
    .click();
  await expect(page.getByRole('dialog')).toContainText(
    'Welcome to Macro, Alex'
  );
  await page.getByLabel('Preview contact').selectOption('jamie@example.com');
  await expect(page.getByRole('dialog')).toContainText(
    'Welcome to Macro, Jamie'
  );
  await page.getByRole('button', { name: 'Close preview' }).click();
  await page.getByRole('button', { name: 'Activate campaign' }).click();
  await expect(page.getByRole('status')).toContainText('Campaign is active');
  await expect(page.getByLabel('Email 1 subject')).toBeDisabled();
  await page.getByRole('button', { name: '＋ Enroll contacts' }).click();
  await page
    .getByRole('checkbox', { name: 'Enroll alex@example.com', exact: true })
    .check();
  await page
    .getByRole('checkbox', { name: 'Enroll jamie@example.com', exact: true })
    .check();
  await page.getByLabel('Confirm permission to email').check();
  await page
    .getByRole('button', { name: 'Enroll 2 contacts', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('2 contacts enrolled');
  await page
    .getByRole('button', { name: 'Enrollments (2)', exact: true })
    .click();
  await expect(
    page.getByText('Welcome to Macro, Alex', { exact: false })
  ).toBeVisible();
  const scheduled = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('marketing-test-outbox') ?? '[]')
  );
  expect(scheduled).toHaveLength(6);
  const alex = scheduled.filter(
    (draft: { email: string }) => draft.email === 'alex@example.com'
  );
  expect(
    new Date(alex[1].sendAt).getTime() - new Date(alex[0].sendAt).getTime()
  ).toBe(2 * 86_400_000);
  expect(
    new Date(alex[2].sendAt).getTime() - new Date(alex[1].sendAt).getTime()
  ).toBe(3 * 86_400_000);
  await page.getByRole('button', { name: 'Alex Morgan', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('A warm welcome');
  await page.getByRole('button', { name: 'Open CRM contact ↗' }).click();
  await expect(
    page.getByRole('heading', { name: 'Alex Morgan' })
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Email Marketing enrollments' })
  ).toContainText('A warm welcome');
  await page.getByRole('button', { name: 'Back to Email Marketing' }).click();
  await page.getByRole('button', { name: /A warm welcome/ }).click();
  await page.getByRole('button', { name: 'Enrollments (2)' }).click();
  await page
    .getByRole('button', { name: 'Pause', exact: true })
    .first()
    .click();
  await expect(page.getByRole('status')).toContainText('Enrollment paused');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('marketing-test-outbox') ?? '[]')
            .length
      )
    )
    .toBe(3);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(
    'Future emails rescheduled'
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('marketing-test-outbox') ?? '[]')
            .length
      )
    )
    .toBe(6);
  await page.getByRole('button', { name: 'Stop', exact: true }).first().click();
  await expect(page.getByRole('status')).toContainText('Enrollment stopped');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('marketing-test-outbox') ?? '[]')
            .length
      )
    )
    .toBe(3);
  await page
    .getByRole('button', { name: 'Pause campaign', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Campaign paused');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('marketing-test-outbox') ?? '[]')
            .length
      )
    )
    .toBe(0);
  await page.reload();
  await page.getByRole('button', { name: /A warm welcome/ }).click();
  await expect(page.getByLabel('Email 1 subject')).toHaveValue(
    'Welcome to Macro, {{firstName}}'
  );
  await page.getByRole('button', { name: 'Enrollments (2)' }).click();
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delivery', exact: true }).click();
  await expect(page.getByText('Not connected', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('active sequences reject duplicate enrollment and readonly controls, and fit a mobile viewport', async ({
  page,
}) => {
  await page.goto(path);
  await page.getByRole('button', { name: /Customer onboarding/ }).click();
  await page.getByRole('button', { name: 'Activate campaign' }).click();
  await page.getByRole('button', { name: '＋ Enroll contacts' }).click();
  await page
    .getByRole('checkbox', { name: 'Enroll alex@example.com', exact: true })
    .check();
  await page.getByLabel('Confirm permission to email').check();
  await page
    .getByRole('button', { name: 'Enroll 1 contact', exact: true })
    .click();
  await page.getByRole('button', { name: '＋ Enroll contacts' }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Enroll alex@example.com', exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Close enrollment' }).click();
  await page.setViewportSize({ width: 430, height: 932 });
  await expect(
    page.getByRole('heading', { name: 'Email Marketing', exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('marketing-test')!);
    data.writable = false;
    localStorage.setItem('marketing-test', JSON.stringify(data));
  });
  await page.reload();
  await expect(
    page.getByRole('button', { name: '＋ New campaign' })
  ).toBeDisabled();
});
