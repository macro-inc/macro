import { expect, test } from '@playwright/test';

const path = '/src/features/email-marketing/browser-test/marketing.html';
test('v1 creates a campaign, previews, enrolls, cross-references CRM, pauses, resumes, and stops', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(path, { waitUntil: 'domcontentloaded' });
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
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /A warm welcome/ }).click();
  await expect(page.getByLabel('Email 1 subject')).toHaveText(
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
  await page.goto(path, { waitUntil: 'domcontentloaded' });
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
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('button', { name: '＋ New campaign' })
  ).toBeDisabled();
});

test('two clients share subjects and messages, merge concurrent typing, retain focus, and restore unsaved content', async ({
  page,
  context,
}) => {
  const peer = await context.newPage();
  const errors: string[] = [];
  for (const client of [page, peer])
    client.on('pageerror', (error) => errors.push(error.message));
  await Promise.all([
    page.goto(`${path}?theme=dark`, { waitUntil: 'domcontentloaded' }),
    peer.goto(`${path}?theme=dark&peer=jamie`, {
      waitUntil: 'domcontentloaded',
    }),
  ]);
  for (const client of [page, peer]) {
    await client.getByRole('button', { name: /Customer onboarding/ }).click();
    await expect(
      client.getByRole('button', { name: 'Activate campaign' })
    ).toBeEnabled();
  }
  const subject = page.getByLabel('Email 1 subject');
  const body = page.getByLabel('Email 1 message');
  const peerBody = peer.getByLabel('Email 1 message');
  await subject.fill('A shared welcome, {{firstName}}');
  await expect(peer.getByLabel('Email 1 subject')).toHaveText(
    'A shared welcome, {{firstName}}'
  );
  await subject.press('End');
  await subject.press('Enter');
  await expect(subject).toHaveText('A shared welcome, {{firstName}}');
  await body.fill('Working together');
  await expect(peerBody).toHaveText('Working together');
  const original = await body.elementHandle();
  await body.press('Control+End');
  await peerBody.press('Control+End');
  await Promise.all([
    body.pressSequentially(' Alex'),
    peerBody.pressSequentially(' Jamie'),
  ]);
  await expect
    .poll(async () => (await body.innerText()) === (await peerBody.innerText()))
    .toBe(true);
  const typed = (await body.innerText()).slice('Working together'.length);
  // Concurrent single-character inserts can interleave; every character must survive.
  expect([...typed].sort().join('')).toBe([...' Alex Jamie'].sort().join(''));
  expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(body).toBeFocused();
  const merged = await body.innerText();
  await page.getByLabel('Move email 2 up').click();
  await expect(page.getByLabel('Email 2 message')).toHaveText(merged);
  expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Customer onboarding/ }).click();
  await expect(page.getByLabel('Email 1 subject')).toHaveText(
    'A shared welcome, {{firstName}}'
  );
  await expect(page.getByLabel('Email 1 message')).toHaveText(merged);
  await expect(
    page.getByRole('button', { name: 'Activate campaign' })
  ).toBeEnabled();
  const chrome = await page
    .getByRole('article', { name: 'Email 1', exact: true })
    .locator(':scope > div')
    .evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        classes: node.className,
        shadow: style.boxShadow,
        radius: style.borderRadius,
        rim: getComputedStyle(node, '::after').boxShadow,
      };
    });
  expect(chrome.classes).toContain('dark-mode:glass-input');
  expect(chrome.shadow).not.toBe('none');
  expect(chrome.radius).toBe('26.25px');
  await page.getByRole('button', { name: 'Activate campaign' }).click();
  await expect(page.getByLabel('Email 1 message')).toHaveValue(merged);
  await peerBody.fill('Later edits from another draft tab');
  await expect(page.getByLabel('Email 1 message')).toHaveValue(merged);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('marketing-test')!).campaigns.find(
      (campaign: { id: string }) => campaign.id === 'example-welcome'
    )
  );
  expect(stored.steps[0].body).toBe(merged);
  expect(errors).toEqual([]);
});

test('failed collaborative initialization blocks activation and can be retried', async ({
  page,
}) => {
  await page.goto(`${path}?failContent=once`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('button', { name: /Customer onboarding/ }).click();
  await expect(
    page.getByRole('button', { name: 'Activate campaign' })
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Save draft', exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Retry shared content' }).click();
  await expect(
    page.getByRole('button', { name: 'Activate campaign' })
  ).toBeEnabled();
  await expect(page.getByLabel('Email 1 subject')).toHaveText(
    'Welcome to Macro, {{firstName}}'
  );
});
