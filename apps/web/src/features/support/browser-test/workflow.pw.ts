import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { NewTicket, Reply, Settings, SupportMessage } from '../core/types';

type SampleWindow = Window & {
  __supportSample: {
    settings: () => Settings;
    openWidget: (input: NewTicket) => Promise<{ token: string }>;
    publicMessages: () => { messages: SupportMessage[] };
    visitorReply: (reply: Reply) => Promise<void>;
  };
};
test('Support inbox, independent Tasks, agent configuration, and embedded customer chat', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const script = readFileSync(
    new URL(
      '../../../../../../crates/support/src/inbound/widget.js',
      import.meta.url
    ),
    'utf8'
  ).replace("mode: 'closed'", "mode: 'open'");
  await page.route('**/support/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/widget.js'))
      return route.fulfill({ contentType: 'text/javascript', body: script });
    if (path.includes('/widget/')) {
      const result =
        request.method() === 'POST'
          ? await page.evaluate(
              (input) =>
                (window as unknown as SampleWindow).__supportSample.openWidget(
                  input
                ),
              request.postDataJSON() as NewTicket
            )
          : await page.evaluate(() => {
              const config = (
                window as unknown as SampleWindow
              ).__supportSample.settings();
              return { name: config.name, welcome: config.welcome };
            });
      return route.fulfill({ json: result });
    }
    if (path.endsWith('/visitor/messages')) {
      expect(request.headers().authorization).toBe(`Bearer ${'a'.repeat(64)}`);
      if (request.method() === 'POST') {
        await page.evaluate(
          (reply) =>
            (window as unknown as SampleWindow).__supportSample.visitorReply(
              reply
            ),
          request.postDataJSON() as Reply
        );
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({
        json: await page.evaluate(() =>
          (window as unknown as SampleWindow).__supportSample.publicMessages()
        ),
      });
    }
    return route.continue();
  });
  await page.goto('/src/features/support/browser-test/index.html');
  await expect(page.locator('.support-ticket-row')).toHaveCount(5);
  await page.waitForTimeout(1400);
  await page
    .getByRole('button', { name: 'High priority', exact: false })
    .click();
  await expect(page.locator('.support-ticket-row')).toHaveCount(3);
  await page.waitForTimeout(800);
  await page
    .getByRole('button', { name: 'Open tickets', exact: false })
    .click();
  await page.getByLabel('Search tickets').fill('Linear');
  await expect(page.locator('.support-ticket-row')).toHaveCount(2);
  await page.waitForTimeout(800);
  await page.getByLabel('Search tickets').clear();
  await page
    .getByRole('button', { name: /Webhook retries are failing/ })
    .click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Use suggestion' }).click();
  await expect(page.getByLabel('Reply composer')).toHaveValue(
    /Thanks for flagging/
  );
  await page.getByLabel('Ticket priority').selectOption('high');
  await expect(page.getByLabel('Reply composer')).toHaveValue(
    /Thanks for flagging/
  );
  await page
    .getByRole('button', { name: 'Internal note', exact: true })
    .click();
  await page
    .getByLabel('Reply composer')
    .fill(
      'Internal: engineering investigation required. Do not send to the customer.'
    );
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.locator('.internal-note')).toContainText(
    'engineering investigation'
  );
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Create or link Task' }).click();
  await page
    .getByLabel('Task title')
    .fill('Investigate webhook retry handling');
  await page
    .getByLabel('Description', { exact: true })
    .fill('Check endpoint timeout handling and retry delivery.');
  await page
    .getByRole('button', { name: 'Create Task', exact: true })
    .last()
    .click();
  await expect(page.locator('.support-linked-task')).toContainText(
    'Investigate webhook retry handling'
  );
  await page
    .locator('.support-linked-task')
    .getByRole('button', { name: /^☑ Investigate webhook/ })
    .click();
  await page.getByLabel('Task status').selectOption('completed');
  await expect(page.locator('.sample-record')).toContainText(
    'Ticket status: open'
  );
  await page.waitForTimeout(900);
  await page.getByLabel('Close preview').click();
  await expect(page.getByLabel('Ticket status')).toHaveValue('open');
  await expect(page.locator('.support-linked-task')).toContainText('completed');
  await page.getByRole('button', { name: 'Reply to customer' }).click();
  await page
    .getByLabel('Reply composer')
    .fill(
      'We’ve linked an engineering Task and are investigating your request IDs. I’ll keep you updated here.'
    );
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByLabel('Ticket status')).toHaveValue(
    'waiting_on_customer'
  );
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Resolve ticket' }).click();
  await expect(page.getByLabel('Ticket status')).toHaveValue('resolved');
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Support agent/ }).click();
  await page.getByText('Give humans time', { exact: true }).click();
  await page.getByLabel('Human response window').fill('7');
  await page.getByLabel('Minimum answer confidence').fill('90');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toContainText('settings saved');
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: 'Channels & installation' }).click();
  await page.getByRole('button', { name: 'Copy embed code' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    'data-macro-support'
  );
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: 'Customer website' }).click();
  const website = page.frameLocator('iframe[title="Customer website"]');
  await website.getByRole('button', { name: 'Chat with us' }).click();
  await website.getByLabel('Your name').fill('Nina Patel');
  await website.getByLabel('Email address').fill('nina@acme.com');
  await website
    .getByLabel('Message', { exact: true })
    .fill('How do I invite my teammates?');
  await website.getByRole('button', { name: 'Send message' }).click();
  await expect(website.getByRole('log')).toContainText(
    'How do I invite my teammates?'
  );
  await page.waitForTimeout(1200);
  await page.getByLabel('Close preview').click();
  await page
    .getByRole('button', { name: 'Open tickets', exact: false })
    .click();
  await page
    .getByRole('button', { name: /How do I invite my teammates\?/ })
    .click();
  await expect(page.locator('.support-agent-draft')).toContainText(
    'Settings → Team'
  );
  await page.waitForTimeout(1100);
  await page
    .getByRole('button', { name: 'Internal note', exact: true })
    .click();
  await page
    .getByLabel('Reply composer')
    .fill('Private onboarding note — never visible in the widget.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await page.getByRole('button', { name: 'Use suggestion' }).click();
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByLabel('Ticket status')).toHaveValue(
    'waiting_on_customer'
  );
  await page.getByRole('button', { name: 'Customer website' }).click();
  await website.getByRole('button', { name: 'Chat with us' }).click();
  await expect(website.getByRole('log')).toContainText(
    'You can invite teammates'
  );
  await expect(website.getByRole('log')).not.toContainText(
    'Private onboarding'
  );
  await page.waitForTimeout(1800);
  expect(errors).toEqual([]);
});

test('Manually created tracking tickets keep customer replies disabled', async ({
  page,
}) => {
  await page.goto('/src/features/support/browser-test/index.html');
  await page.getByRole('button', { name: 'New ticket' }).click();
  await page
    .getByLabel('Subject', { exact: true })
    .fill('Track a customer escalation');
  await page.getByLabel('Customer name').fill('Jordan Chen');
  await page.getByLabel('Customer email').fill('jordan@acme.com');
  await page
    .getByLabel('Message', { exact: true })
    .fill('Customer raised this during a call.');
  await page
    .getByRole('button', { name: 'Create ticket', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Reply to customer' })
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add note' })).toBeVisible();
  await expect(page.locator('.support-conversation')).toContainText(
    'Tracking ticket'
  );
  await page
    .getByLabel('Reply composer')
    .fill('Engineering follow-up tracked internally.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.locator('.internal-note')).toContainText(
    'Engineering follow-up'
  );
  await expect(page.getByLabel('Ticket status')).toHaveValue('open');
});
