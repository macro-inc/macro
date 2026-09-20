import { expect, type Route, test } from '@playwright/test';

test('live channel: delayed enrichment, draft, removal and server persistence', async ({
  page,
  baseURL,
}) => {
  const email = `preview-${Date.now()}@test.macro.local`;
  const login = await page.request.post('/auth/login/passwordless', {
    data: { email, redirect_uri: `${baseURL}/app` },
  });
  expect(login.status()).toBe(200);
  const { code } = await login.json();
  expect(code).toBeTruthy();
  const authenticated = await page.request.get(
    `/auth/oauth/passwordless/${code}?email=${encodeURIComponent(email)}&disable_redirect=true`
  );
  expect(authenticated.ok()).toBe(true);
  const onboarding = await page.request.post('/cognition/onboarding/complete', {
    data: { skipped: true },
  });
  expect(onboarding.ok()).toBe(true);
  const tutorial = await page.request.patch('/auth/user/tutorial', {
    data: { tutorialComplete: true },
  });
  expect(tutorial.ok()).toBe(true);
  const channelResponse = await page.request.post('/dss/channels', {
    data: {
      channel_type: 'private',
      name: 'Link preview verification',
      participants: [],
    },
  });
  expect(channelResponse.ok()).toBe(true);
  const { id: channelId } = await channelResponse.json();
  const url = 'https://example.com/verification-a';
  const otherUrl = 'https://example.com/verification-b';
  const posted = await page.request.post(`/dss/channels/${channelId}/message`, {
    data: {
      content: `Read ${url}. ${otherUrl}\nCode stays intact: \`${url}\``,
      attachments: [],
      mentions: [],
    },
  });
  expect(posted.ok()).toBe(true);
  const original = await posted.json();
  const messageId = original.id;
  expect(messageId).toBeTruthy();

  let ready = false;
  const waiting: Route[] = [];
  const respond = (route: Route) => {
    const { url_list } = route.request().postDataJSON() as {
      url_list: string[];
    };
    return route.fulfill({
      json: {
        responses: url_list.map((link) => ({
          url: link,
          title:
            link === url
              ? 'Preview A — loaded without moving messages'
              : 'Preview B — fixed height',
          description:
            'Metadata arrives late. The channel, message positions, and draft should remain stable.',
          image_url: 'https://example.com/verification-image.svg',
        })),
      },
    });
  };
  await page.route('**/unfurl/bulk', (route) =>
    ready ? respond(route) : void waiting.push(route)
  );
  let imagesReady = false;
  const images: Route[] = [];
  const respondImage = (route: Route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#dbeafe"/><circle cx="400" cy="200" r="150" fill="#2563eb"/></svg>',
    });
  await page.route('**/unfurl/proxy?*', (route) =>
    imagesReady ? respondImage(route) : void images.push(route)
  );
  await page.goto(`/app/channel/${channelId}`);
  const message = page.locator(`[data-message-id="${messageId}"]`);
  await expect(message).toBeVisible({ timeout: 45_000 });
  const cards = message.locator('[data-link-preview]');
  await expect(cards).toHaveCount(2);
  await expect.poll(() => waiting.length).toBeGreaterThan(0);
  const composer = page
    .locator(
      `[data-input-id="channel-input-${channelId}"] [contenteditable="true"]`
    )
    .first();
  const openComposer = async () => {
    const collapsed = page.locator(
      `[data-input-id="channel-input-${channelId}"] [data-collapsed-input-preview]`
    );
    if (await collapsed.isVisible()) await collapsed.click();
  };
  await openComposer();
  await composer.fill('Draft stays here while previews load');
  // Let the intentional mobile composer expansion settle before measuring
  // changes caused by metadata and images.
  await page.waitForTimeout(1800);
  const before = await message.boundingBox();
  ready = true;
  await Promise.all(waiting.splice(0).map(respond));
  await expect(
    message.getByText('Preview A — loaded without moving messages').first()
  ).toBeVisible();
  expect(await message.boundingBox()).toEqual(before);
  await page.waitForTimeout(1800);
  imagesReady = true;
  await Promise.all(images.splice(0).map(respondImage));
  await expect
    .poll(() =>
      cards
        .locator('img')
        .first()
        .evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0
        )
    )
    .toBe(true);
  expect(await message.boundingBox()).toEqual(before);
  await expect(composer).toHaveText('Draft stays here while previews load');
  await page.waitForTimeout(1800);

  const failedRemovals: Route[] = [];
  const mutationPath = `**/channels/${channelId}/message/${messageId}`;
  await page.route(mutationPath, (route) => {
    failedRemovals.push(route);
  });
  for (let index = 0; index < 2; index++) {
    await cards.first().hover();
    await cards
      .first()
      .getByRole('button', { name: 'Remove link preview' })
      .click();
  }
  await expect(cards).toHaveCount(0);
  await expect.poll(() => failedRemovals.length).toBe(2);
  await failedRemovals[1].fulfill({
    status: 500,
    json: { message: 'Controlled test failure' },
  });
  await expect(cards).toHaveCount(1);
  await failedRemovals[0].fulfill({
    status: 500,
    json: { message: 'Controlled test failure' },
  });
  await expect(cards).toHaveCount(2);
  await expect(composer).toHaveText('Draft stays here while previews load');
  await page.unroute(mutationPath);
  await page.waitForTimeout(1800);

  const removed = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/channels/${channelId}/message/${messageId}`) &&
      response.request().method() === 'PATCH'
  );
  await cards.first().hover();
  await cards
    .first()
    .getByRole('button', { name: 'Remove link preview' })
    .click();
  expect((await removed).ok()).toBe(true);
  await expect(cards).toHaveCount(1);
  const stored = await page.request.get(
    `/dss/messages/channel/${channelId}/items/${messageId}`
  );
  expect(stored.ok()).toBe(true);
  const persisted = await stored.json();
  expect(persisted.content).toContain('"preview":false');
  expect(persisted.content).toContain(`\`${url}\``);
  expect(persisted.edited_at).toBeNull();
  await expect(composer).toHaveText('Draft stays here while previews load');
  await openComposer();
  await composer.fill('');
  // Prove persistence comes from server content, independent of optimistic storage.
  await page.evaluate(() =>
    localStorage.removeItem('channel.hiddenLinkPreviews')
  );
  await page.reload();
  await expect(message).toBeVisible({ timeout: 30_000 });
  await expect(cards).toHaveCount(1);
  await page.waitForTimeout(1800);
  const sentText = 'Posted from Chrome: https://example.com/verification-c';
  await openComposer();
  await composer.fill(sentText);
  await page
    .locator(
      `[data-input-id="channel-input-${channelId}"] [data-input-action="send"]`
    )
    .click();
  const sent = page
    .locator('[data-message]')
    .filter({ hasText: sentText })
    .last();
  await expect(sent).toBeVisible();
  await expect(sent.locator('[data-link-preview]')).toHaveCount(1);
  await expect(composer).toBeEmpty();
  await page.waitForTimeout(1800);
});
