import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

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
        ])
      ),
      ...Object.fromEntries(
        ['CA', 'CB', 'CC'].map((id) => [
          `${id}/2023-11-14.json`,
          strToU8(
            JSON.stringify([
              {
                type: 'message',
                user: 'U1',
                ts: '1700000000.000001',
                text: 'Reference <#CB|unselected>',
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
    await expect(page.getByText('2 selected.', { exact: false })).toBeVisible();
    if (!history) await page.getByLabel('Include message history').uncheck();
    await page
      .getByRole('button', { name: 'Import selected channels (2)' })
      .click();
    await expect(
      page.getByText('completed with errors', { exact: true })
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
      .getByRole('button', { name: /2026-09-30.*completed with errors/ })
      .click();
    await expect(
      page.getByText(
        `2 selected · ${history ? 'With' : 'Without'} message history`
      )
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'same name', exact: true })
    ).toHaveCount(2);
    await expect(page.getByText('Error: invalid input')).toBeVisible();
    await expect(page.getByText('unselected', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Filter conversations')).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem('slack-test-writes') ?? '[]')
      )
    ).toEqual(writes);
  });
}
