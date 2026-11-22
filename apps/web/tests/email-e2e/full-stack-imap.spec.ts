import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { FROM_TEST, startFront } from './harness/front';
import { LocalStack, localStackAddresses } from './harness/local-stack';
import { replyEditor } from './harness/send';
import { restMatcher } from './ledger/ledger';
import {
  IMAP_CONFIRMATION,
  IMAP_EVIDENCE,
  IMAP_JOURNEY,
  IMAP_OPERATIONS,
} from './ledger/manifest/imap';
import { REST } from './ledger/manifest/network';

const labControl = fileURLToPath(
  new URL('../../../../docker/imap-lab/control.py', import.meta.url)
);
const dist =
  process.env.EMAIL_E2E_DIST ??
  fileURLToPath(new URL('../../dist', import.meta.url));

// Credential-bearing request bodies must never be stored in traces.
test.use({ trace: 'off' });
// Both layouts submit to the same real relay and share its per-host connection limit.
test.describe.configure({ mode: 'default', timeout: 180_000 });

async function fillLabCredentials(dialog: Locator, email: string) {
  await expect(dialog.getByLabel('Email address')).toHaveValue(email);
  const details = dialog.getByRole('button', {
    name: 'Server settings',
    exact: true,
  });
  if ((await details.getAttribute('aria-expanded')) !== 'true')
    await details.click();
  for (const name of ['Incoming mail (IMAP)', 'Outgoing mail (SMTP)']) {
    const server = dialog.getByRole('group', { name });
    await server.getByLabel('Server name').fill('maillab.example.net');
    await expect(server.getByLabel('Username')).toHaveValue(email);
  }
  const trust = dialog.getByRole('checkbox', { name: /I trust/ });
  if (!(await trust.isChecked())) await dialog.getByText(/^I trust/).click();
  await expect(trust).toBeChecked();
  await dialog.getByLabel('Password or app password').fill('pass');
}

async function chooseSetting(dialog: Locator, label: RegExp, value: string) {
  const trigger = dialog.getByRole('button', { name: label });
  await trigger.press('ArrowDown');
  await dialog.getByRole('option', { name: value, exact: true }).click();
  await expect(dialog.page().getByRole('listbox')).toHaveCount(0);
  await expect(trigger).toHaveText(value);
}

async function submitConnection(page: Page, dialog: Locator, mobile: boolean) {
  const submit = dialog.getByRole('button', { name: 'Connect inbox' });
  await expect(submit).toBeEnabled();
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/email/links/imap'),
      { timeout: 30_000 }
    ),
    mobile ? submit.tap() : submit.click(),
  ]);
  expect(response.ok(), `connection answered ${response.status()}`).toBe(true);
  return response;
}

for (const mobile of [false, true]) {
  test.describe(mobile ? 'mobile IMAP inbox' : 'desktop IMAP inbox', () => {
    test.use({
      hasTouch: mobile,
      isMobile: mobile,
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1360, height: 860 },
    });

    test(IMAP_JOURNEY, async ({ page }) => {
      const mailpit = process.env.EMAIL_E2E_STACK_MAILPIT_URL;
      const local = localStackAddresses();
      test.skip(
        !mailpit || !local || !process.env.IMAP_LAB_IMAPS_PORT,
        'Requires just imap-e2e-browser'
      );
      if (!local || !mailpit) return;
      const stack = new LocalStack(local, { seedGoogleGrant: false });
      const id = randomUUID().slice(0, 12);
      const email = `reader-${id}@maillab.example.net`;
      const sender = `writer-${id}@maillab.example.net`;
      const subject = `Mail round trip ${id}`;
      const message = 'Can you confirm you received my note?';
      try {
        const user = await stack.user(email);
        execFileSync('python3', [labControl], {
          input: JSON.stringify({
            operation: 'deliver',
            email,
            from: sender,
            subject,
            text: message,
          }),
          timeout: 15_000,
        });
        const front = await startFront({
          dist,
          emailUrl: stack.info.emailUrl,
          documentStorageUrl: stack.info.documentStorageUrl,
          internalApiKey: stack.info.internalApiKey,
          user,
          proxyUrl: local.proxyUrl,
        });
        try {
          await page.addInitScript(() =>
            localStorage.setItem('macro:login', 'true')
          );
          await page.goto(`${front.origin}/app/mail`);
          await expect(
            page.getByText('Connect your email', { exact: true })
          ).toBeVisible();
          await page
            .getByRole('button', { name: 'Connect email', exact: true })
            .click();
          // Reserved lab domains intentionally have no passive MX suggestion.
          // Exercise the ordinary manual path instead of changing product DNS policy.
          await page
            .getByRole('dialog')
            .getByRole('button', {
              name: 'Other email (IMAP / SMTP)',
              exact: true,
            })
            .click();
          const dialog = page.getByRole('dialog');
          await expect(dialog.getByLabel('Email address')).toHaveValue(email);
          await dialog
            .getByRole('button', { name: 'Find settings', exact: true })
            .click();
          await fillLabCredentials(dialog, email);
          const response = await submitConnection(page, dialog, mobile);
          const { linkId } = (await response.json()) as { linkId: string };
          const traceparent = await response
            .request()
            .headerValue('traceparent');
          const traceId = traceparent?.match(
            /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/
          )?.[1];
          if (traceId) {
            await test.info().attach('imap-enrollment-trace', {
              body: JSON.stringify({ linkId, traceId }),
              contentType: 'application/json',
            });
          }
          await expect(dialog).toHaveCount(0);
          const states = [];
          await expect(
            page
              .getByRole('status')
              .filter({ hasText: IMAP_CONFIRMATION.connect })
          ).toBeVisible();
          states.push(IMAP_CONFIRMATION.connect);

          let threadId: string | undefined;
          await expect
            .poll(
              async () => {
                const previews = await fetch(
                  `${front.origin}/email/email/threads/previews/cursor/all?limit=100`,
                  {
                    headers: { 'x-email-link-id': linkId, [FROM_TEST]: '1' },
                  }
                );
                if (!previews.ok) return false;
                const { items } = (await previews.json()) as {
                  items: { id: string; name: string }[];
                };
                threadId = items.find((item) => item.name === subject)?.id;
                return !!threadId;
              },
              { timeout: 60_000 }
            )
            .toBe(true);
          await page.goto(`${front.origin}/app/mail/${threadId}`);
          await expect(
            page.getByRole('paragraph').filter({ hasText: message }).first()
          ).toBeVisible();
          const reply = mobile
            ? page
                .getByRole('region', { name: 'Reading pane' })
                .getByRole('button', { name: 'Reply', exact: true })
            : page.getByText('Reply...', { exact: true });
          await reply.click();
          const editor = mobile
            ? page
                .getByRole('dialog')
                .getByRole('textbox', { name: 'Use `@` to reference files' })
            : replyEditor(page);
          await editor.pressSequentially('Confirmed in Macro.');
          await page.getByRole('button', { name: 'Send email' }).click();
          await expect
            .poll(
              async () => {
                const url = new URL('/api/v1/search', mailpit);
                url.searchParams.set('query', `to:${sender}`);
                const response = await fetch(url);
                if (!response.ok) return undefined;
                const { messages } = (await response.json()) as {
                  messages: { Subject: string }[];
                };
                return messages.map((mail) => mail.Subject);
              },
              { timeout: 90_000 }
            )
            .toEqual([`Re: ${subject}`]);

          await page.goto(`${front.origin}/app/mail/~/settings/email`);
          const openSettings = page.getByRole('button', {
            name: 'Server settings',
            exact: true,
          });
          await openSettings.click();
          const configured = page.getByRole('dialog', {
            name: 'Mail server settings',
          });
          await expect(
            configured.getByText('maillab.example.net:993', { exact: false })
          ).toBeVisible();
          await expect(
            configured.getByText('maillab.example.net:465', { exact: false })
          ).toBeVisible();
          await expect(configured.getByText(/IDLE.*UIDPLUS/)).toBeVisible();
          await chooseSetting(configured, /^Role for Archive\b/, 'Other');
          await expect(configured).toBeVisible();
          if (
            await configured
              .getByRole('checkbox', { name: 'Sync Junk', exact: true })
              .isChecked()
          )
            await configured
              .getByRole('checkbox', { name: 'Sync Junk', exact: true })
              .locator('..')
              .getByText('Sync folder', { exact: true })
              .click();
          await expect(
            configured.getByRole('checkbox', { name: 'Sync Junk', exact: true })
          ).not.toBeChecked();
          await chooseSetting(
            configured,
            /^Watch for new mail alongside Inbox\b/,
            'Sent'
          );
          await configured
            .getByRole('button', { name: 'Save settings' })
            .click();
          await expect(configured).toHaveCount(0);
          await openSettings.click();
          await expect(
            configured.getByRole('button', {
              name: /^Role for Archive\b/,
            })
          ).toHaveText('Other');
          await expect(
            configured.getByRole('checkbox', { name: 'Sync Junk', exact: true })
          ).not.toBeChecked();
          await expect(
            configured.getByRole('button', {
              name: /^Watch for new mail alongside Inbox\b/,
            })
          ).toHaveText('Sent');

          await configured
            .getByRole('button', { name: 'Change login details' })
            .click();
          await expect(configured).toHaveCount(0);
          const reconnect = page.getByRole('dialog', {
            name: 'Reconnect inbox',
          });
          await fillLabCredentials(reconnect, email);
          const promotion = await submitConnection(page, reconnect, mobile);
          expect((await promotion.json()).linkId).toBe(linkId);
          await expect(
            page
              .getByRole('status')
              .filter({ hasText: IMAP_CONFIRMATION.reconnect })
          ).toBeVisible();
          states.push(IMAP_CONFIRMATION.reconnect);

          const match = restMatcher(REST);
          const imapOperations = new Set<string>(IMAP_OPERATIONS);
          const operations = front.requests
            .filter(
              (r) =>
                !r.fromTest &&
                r.answeredBy === 'email' &&
                r.status >= 200 &&
                r.status < 300
            )
            .map((r) => match(r.method, `/email${r.path}`))
            .filter((id): id is string => !!id && imapOperations.has(id));
          expect(new Set(operations)).toEqual(imapOperations);
          await test.info().attach(IMAP_EVIDENCE, {
            contentType: 'application/json',
            body: JSON.stringify({ states, operations }),
          });
        } finally {
          await front.close();
        }
      } finally {
        await stack.finish();
      }
    });
  });
}
