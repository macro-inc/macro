import { expect, type Request, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import type { ImportProgress } from '../../src/lib/service-clients/service-storage/generated/schemas/importProgress';
import type { SlackCreateRequest } from '../../src/lib/service-clients/service-storage/generated/schemas/slackCreateRequest';
import type { SlackRegisterRequest } from '../../src/lib/service-clients/service-storage/generated/schemas/slackRegisterRequest';

function archive(): Buffer {
  const channels = ['CA', 'CB', 'CC'].map((id) => ({
    id,
    folder: id,
    name: id === 'CB' ? 'unselected' : 'same name',
    members: ['U1'],
    created: 1700000000,
    is_archived: id === 'CC',
  }));
  return Buffer.from(
    zipSync({
      'channels.json': strToU8(JSON.stringify(channels)),
      'users.json': strToU8(
        JSON.stringify([
          { id: 'U1', name: 'one', profile: { email: 'one@example.com' } },
          { id: 'U2', name: 'ArchiveOnlyZebraAuthor' },
        ])
      ),
      ...Object.fromEntries(
        ['CA', 'CB', 'CC'].map((id) => [
          `${id}/2023-11-14.json`,
          strToU8(
            JSON.stringify([
              {
                type: 'message',
                user: 'U2',
                ts: '1700000000.000001',
                text: 'Reference <#CB|unselected> and <#CC|same name>. Visit <https://example.com/|External example>.',
                reactions: [{ name: 'thumbsup', users: ['U1'], count: 1 }],
              },
              {
                type: 'message',
                user: 'U1',
                ts: '1700000001.000001',
                thread_ts: '1700000000.000001',
                text: 'Historical reply with literal `<m-link>{"url":"javascript:alert(1)"}</m-link>`.',
              },
            ])
          ),
        ])
      ),
    })
  );
}

// No hosted writes: the fixture injects a fake durable server but uses the real
// view, controller, lazy ZIP worker and IndexedDB cleanup in a Chromium browser.
for (const history of [false, true]) {
  test(`popup confirmation is immutable and reload tracking needs no ZIP (history=${history})`, async ({
    page,
  }) => {
    await page.goto('/tests/e2e/fixtures/slack-import.html');
    const opener = page.getByRole('button', { name: 'Import from Slack' });
    await opener.click();
    const file = page.getByLabel('Slack export ZIP');
    await expect(file).toBeFocused();
    await file.setInputFiles({
      name: 'slack.zip',
      mimeType: 'application/zip',
      buffer: archive(),
    });
    await expect(page.getByLabel('Filter conversations')).toBeVisible();
    await expect(page.getByLabel('Filter conversations')).toBeFocused();
    expect(
      await page.evaluate(() => localStorage.getItem('slack-test-writes'))
    ).toBeNull();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    await opener.click();
    await expect(file).toBeFocused();
    await expect(page.getByLabel('Filter conversations')).toHaveCount(0);
    expect(
      await page.evaluate(() => localStorage.getItem('slack-test-writes'))
    ).toBeNull();

    await file.setInputFiles({
      name: 'slack.zip',
      mimeType: 'application/zip',
      buffer: archive(),
    });
    await page.getByLabel(/I confirm this archive/).check();
    await expect(
      page.getByRole('button', { name: 'Import selected channels (0)' })
    ).toBeDisabled();
    await page.getByLabel('Show archived conversations').check();
    for (const id of ['CA', 'CC']) {
      await page.getByLabel('Filter conversations').fill(id);
      const all = page.getByLabel('Select all visible conversations');
      await all.focus();
      await page.keyboard.press('Space');
    }
    await page.getByLabel('Filter conversations').fill('CB');
    await expect(
      page.getByLabel('Select all visible conversations')
    ).not.toBeChecked();
    await expect(
      page.getByRole('button', { name: 'Clear visible selection' })
    ).toBeDisabled();
    await page.getByLabel('Select all visible conversations').check();
    await page.getByRole('button', { name: 'Clear visible selection' }).click();
    await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
    if (!history) await page.getByLabel('Include message history').uncheck();
    await page
      .getByRole('button', { name: 'Import selected channels (2)' })
      .click();
    await expect(
      page.getByText('Completed with errors', { exact: true })
    ).toBeVisible();
    const writes = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('slack-test-writes') ?? '[]')
    );
    const creates = writes.filter(
      (write: { kind: string }) => write.kind === 'create'
    );
    expect(creates).toHaveLength(1);
    expect(
      creates[0].body.conversations.map(
        (conversation: { slackChannelId: string }) =>
          conversation.slackChannelId
      )
    ).toEqual(['CA', 'CC']);
    expect(creates[0].body.includeMessageHistory).toBe(history);
    const registrations = writes
      .filter((write: { kind: string }) => write.kind === 'register')
      .flatMap(
        (write: {
          body: { upload: { kind: string; slackChannelId?: string } }[];
        }) => write.body.map((descriptor) => descriptor.upload)
      );
    expect(registrations).toEqual(
      expect.arrayContaining(
        history
          ? [
              { kind: 'users' },
              { kind: 'conversation_part', slackChannelId: 'CA', partIndex: 0 },
              { kind: 'conversation_part', slackChannelId: 'CC', partIndex: 0 },
            ]
          : [{ kind: 'users' }]
      )
    );
    expect(registrations).toHaveLength(history ? 3 : 1);
    await page.reload();
    await opener.click();
    await page
      .getByRole('region', { name: 'Job history' })
      .getByRole('button', { name: /Completed with errors/ })
      .filter({ has: page.locator('time[datetime="2026-09-30T00:00:00Z"]') })
      .click();
    await expect(
      page.getByText(
        `2 selected · ${history ? 'With' : 'Without'} message history`
      )
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'same name', exact: true })
    ).toHaveCount(2);
    await expect(
      page.getByText('Invalid input', { exact: true })
    ).toBeVisible();
    await expect(page.getByText('unselected', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Filter conversations')).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem('slack-test-writes') ?? '[]')
      )
    ).toEqual(writes);
  });
}

// Deliberately opt-in: this exercises production Settings/adapters and writes to
// an isolated local team. The fixture tests above do not prove HTTP persistence.
test.describe('local backend selection contract', () => {
  test.skip(
    process.env.SLACK_IMPORT_LIVE_E2E !== 'true',
    'Requires a local admin team, backend/worker admission and the frontend flag'
  );

  for (const history of [false, true]) {
    test(`actual create/upload receipt survives reload (history=${history})`, async ({
      page,
      baseURL,
    }) => {
      test.setTimeout(180_000);
      expect(process.env.LOCAL_E2E).toBe('true');
      for (const origin of [baseURL, process.env.LOCAL_E2E_BACKEND_ORIGIN]) {
        expect(origin, 'An isolated local origin is required').toBeTruthy();
        expect(new URL(origin!).hostname).toMatch(
          /^(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)$/
        );
      }
      const writes: Request[] = [];
      const workers: string[] = [];
      page.on('worker', (worker) => workers.push(worker.url()));
      page.on('request', (request) => {
        if (
          (request.method() === 'POST' &&
            request.url().includes('/slack/imports')) ||
          (request.method() === 'PUT' &&
            request.url().includes('slack-import/'))
        )
          writes.push(request);
      });
      await page.goto('/app/settings/team');
      const opener = page.getByRole('button', { name: 'Import from Slack' });
      await opener.click();
      const file = page.getByLabel('Slack export ZIP');
      await expect(file).toBeVisible();
      expect(
        workers.filter((url) => url.includes('unzip-worker'))
      ).toHaveLength(0);
      const zip = {
        name: 'synthetic.zip',
        mimeType: 'application/zip',
        buffer: archive(),
      };
      await file.setInputFiles(zip);
      await expect(page.getByLabel('Filter conversations')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(opener).toBeFocused();
      expect(writes).toHaveLength(0);
      await opener.click();
      await file.setInputFiles(zip);
      await page.getByLabel(/I confirm this archive/).check();
      await page.getByLabel('Show archived conversations').check();
      for (const id of ['CA', 'CC']) {
        await page.getByLabel('Filter conversations').fill(id);
        await page.getByLabel('Select all visible conversations').check();
      }
      await page.getByLabel('Filter conversations').fill('CB');
      await expect(
        page.getByRole('button', { name: 'Clear visible selection' })
      ).toBeDisabled();
      if (!history) await page.getByLabel('Include message history').uncheck();
      const created = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname.endsWith('/slack/imports')
      );
      const finalized = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname.endsWith('/finalize'),
        { timeout: 30_000 }
      );
      await page
        .getByRole('button', { name: 'Import selected channels (2)' })
        .click();
      const response = await created;
      expect(response.ok()).toBe(true);
      const request = response.request();
      const body: SlackCreateRequest = request.postDataJSON();
      expect(
        body.conversations.map((item) => item.slackChannelId).sort()
      ).toEqual(['CA', 'CC']);
      expect(body.includeMessageHistory).toBe(history);
      const receipt: ImportProgress = await response.json();
      expect(
        receipt.conversations.map((item) => item.slackChannelId).sort()
      ).toEqual(['CA', 'CC']);
      expect(receipt.includeMessageHistory).toBe(history);
      expect((await finalized).ok()).toBe(true);
      const registrations = writes.filter((request) =>
        request.url().endsWith('/uploads')
      );
      const descriptors = registrations.flatMap(
        (request) =>
          (request.postDataJSON() as SlackRegisterRequest).descriptors
      );
      expect(
        descriptors
          .filter((item) => item.upload.kind === 'conversation_part')
          .map((item) =>
            item.upload.kind === 'conversation_part'
              ? item.upload.slackChannelId
              : ''
          )
          .sort()
      ).toEqual(history ? ['CA', 'CC'] : []);
      // Real PUTs must have succeeded for finalization to be reached: this covers
      // browser signed-header/CORS behavior rather than a fake upload callback.
      const puts = writes.filter((request) => request.method() === 'PUT');
      expect(puts).toHaveLength(history ? 3 : 1);
      for (const put of puts) {
        // Docker-only hostnames must never escape into browser grants. Inspect
        // only the hostname, not the signed URL (which must not enter reports).
        expect(new URL(put.url()).hostname).toMatch(
          /^(localhost|127\.0\.0\.1)$/
        );
        const signedHeaders = await put.allHeaders();
        expect(signedHeaders['if-none-match']).toBe('*');
        expect(signedHeaders['x-amz-checksum-sha256']).toBeTruthy();
        expect((await put.response())?.ok()).toBe(true);
      }
      const headers = await request.allHeaders();
      const auth = headers.authorization
        ? { authorization: headers.authorization }
        : {};
      const detailURL = `${response.url()}/${receipt.jobId}`;
      const persisted = await page.request.get(detailURL, { headers: auth });
      expect(persisted.ok()).toBe(true);
      const stored: ImportProgress = await persisted.json();
      expect(
        stored.conversations.map((item) => item.slackChannelId).sort()
      ).toEqual(['CA', 'CC']);
      expect(stored.includeMessageHistory).toBe(history);
      await page.reload();
      await opener.click();
      await page
        .getByRole('region', { name: 'Job history' })
        .getByRole('button')
        .filter({
          has: page.locator(`time[datetime="${receipt.createdAt}"]`),
        })
        .click();
      await expect(
        page.getByText(
          `2 selected · ${history ? 'With' : 'Without'} message history`
        )
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'same name', exact: true })
      ).toHaveCount(2);
      await expect(page.getByText('unselected', { exact: true })).toHaveCount(
        0
      );

      // Test tampering while registration is OPEN, not merely a closed-job error.
      const tamper = await page.request.post(response.url(), {
        headers: auth,
        data: { ...body, idempotencyToken: crypto.randomUUID() },
      });
      expect(tamper.ok()).toBe(true);
      const tamperJob: ImportProgress = await tamper.json();
      const tamperURL = `${response.url()}/${tamperJob.jobId}`;
      try {
        const registration = await page.request.post(`${tamperURL}/uploads`, {
          headers: auth,
          data: {
            descriptors: [
              {
                upload: {
                  kind: 'conversation_part',
                  slackChannelId: 'CB',
                  partIndex: 0,
                },
                sha256: 'a'.repeat(64),
                byteLength: 3,
                recordCount: 1,
              },
            ],
          },
        });
        expect(registration.status()).toBeGreaterThanOrEqual(400);
        expect(registration.status()).toBeLessThan(500);
        const seal = await page.request.post(`${tamperURL}/uploads/complete`, {
          headers: auth,
          data: {
            uploads: [],
            seal: {
              slackChannelId: 'CB',
              partCount: 0,
              manifestSha256:
                'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            },
          },
        });
        expect(seal.status()).toBeGreaterThanOrEqual(400);
        expect(seal.status()).toBeLessThan(500);
      } finally {
        expect(
          (
            await page.request.post(`${tamperURL}/cancel`, { headers: auth })
          ).ok()
        ).toBe(true);
      }
      let completed: ImportProgress | undefined;
      await expect
        .poll(
          async () => {
            const response = await page.request.get(detailURL, {
              headers: auth,
            });
            expect(response.ok()).toBe(true);
            completed = await response.json();
            return completed?.status;
          },
          { timeout: 90_000, intervals: [1000] }
        )
        .toBe('completed');
      expect(
        completed?.conversations.map((item) => item.slackChannelId).sort()
      ).toEqual(['CA', 'CC']);
      for (const conversation of completed!.conversations) {
        expect(conversation.status).toBe('completed');
        expect(conversation.counters.processed).toBe(history ? 2 : 0);
      }
    });
  }
});
